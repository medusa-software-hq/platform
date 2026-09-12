import * as cloudflare from '@pulumi/cloudflare';
import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import * as service from '@pulumi/pulumiservice';
import * as random from '@pulumi/random';
import {
  appPool,
  appPoolProvider,
  DEPLOY_OPERATIONS,
  deploySubject,
  pulumiOrganization,
} from './app-identity.ts';
import { appImages } from './app-images.ts';
import { centralProject, centralServices } from './central.ts';
import { appFolders } from './folders.ts';
import {
  byAppEnvironment,
  ENVIRONMENT_SHORT_NAMES,
  type App,
  type AppEnvironmentKey,
  type Environment,
} from './model.ts';
import { billingAccount, githubOrganization, primaryLocation } from './organization.ts';

const config = new pulumi.Config();
const cloudflareAccountId = config.require('cloudflareAccountId');

/**
 * What an app may do in Cloudflare: replace the contents of a Worker, and nothing else.
 *
 * Cloudflare scopes this permission to an account and offers nothing finer — no
 * per-script grant exists. So an app can in principle overwrite a sibling's code. That
 * is accepted deliberately: the boundary worth holding is the zone, and no app has any
 * zone permission at all, so none can create, move or repoint a hostname.
 *
 * The identifier rather than a lookup: these are Cloudflare-wide constants, and the
 * data source returns no permission groups whether the name filter is URL-encoded or
 * not. Read back from the account's own list, where it is named `Workers Scripts Write`.
 */
const WORKERS_SCRIPTS_WRITE = 'e086da7e2179491d91ee5f35b3ca210a';

interface AppEnvironmentArgs {
  app: App;
  environment: Environment;
  folder: gcp.organizations.Folder;
}

/**
 * One app in one environment: its project, the account that deploys into it, and the
 * environment that account is reached through.
 *
 * The project sits in its own folder, so an app is a subtree rather than pieces
 * scattered across shared ones. The account deliberately does not: an app holds broad
 * rights inside its project, so an account kept there would be one it could rewrite.
 * It lives in central, which apps cannot write to.
 *
 * `roles/owner` on its own project, rather than an enumerated list. The list was the
 * wrong granularity — needing a Pub/Sub topic should not be a change to this repository
 * — and it was never a real bound anyway, since any role permitting `setIamPolicy`
 * lets the holder widen it. The actual bound is the service policy the bootstrap stack
 * sets above these folders, which nothing here can override.
 */
export class AppEnvironment extends pulumi.ComponentResource {
  readonly project: gcp.organizations.Project;
  readonly serviceAccount: gcp.serviceaccount.Account;
  readonly environment: service.Environment;
  readonly cloudflareToken: cloudflare.AccountToken;

  constructor(
    { app, environment, folder }: AppEnvironmentArgs,
    options?: pulumi.ComponentResourceOptions,
  ) {
    const name = `${app}-${environment}`;
    super('medusa:platform:AppEnvironment', name, {}, options);

    const parent = { parent: this };

    const suffix = new random.RandomId(`${name}-project-suffix`, { byteLength: 2 }, parent);

    this.project = new gcp.organizations.Project(
      name,
      {
        // Parentheses are rejected; the allowed set is letters, digits, hyphen,
        // quotes, space and exclamation mark.
        name: `${app} - ${environment}`,
        projectId: suffix.hex.apply(
          (hex) => `ms-${app}-${ENVIRONMENT_SHORT_NAMES[environment]}-${hex}`,
        ),
        folderId: folder.folderId,
        billingAccount: billingAccount.id,

        // Exploration phase: `destroy` should actually destroy.
        deletionPolicy: 'DELETE',
      },
      parent,
    );

    this.serviceAccount = new gcp.serviceaccount.Account(
      name,
      {
        project: centralProject.projectId,
        accountId: `${app}-${ENVIRONMENT_SHORT_NAMES[environment]}`,
        displayName: `${app} - ${environment}`,
        description: `Deploys ${app} into ${environment}.`,
      },
      { parent: this, dependsOn: centralServices },
    );

    new gcp.projects.IAMMember(
      `${name}-owner`,
      {
        project: this.project.projectId,
        role: 'roles/owner',
        member: this.serviceAccount.member,
      },
      parent,
    );

    // One environment, one account. Service account IAM takes well over a minute to
    // take effect, and while it propagates the token exchange succeeds and only the
    // impersonation is denied — which reads exactly like a malformed principal.
    /**
     * Assumable by a deployment of this app's stack, and by nothing else.
     *
     * Not by whoever opens the environment: an environment's subject names an
     * environment and no operation, and it arrives as Pulumi configuration, which
     * overrides the credentials a deployment mints for itself. Bound per operation
     * because the subject carries the operation and GCP has no wildcard, which is what
     * makes the omission of `destroy` mean something.
     */
    for (const operation of DEPLOY_OPERATIONS) {
      new gcp.serviceaccount.IAMMember(
        `${name}-deploy-${operation}`,
        {
          serviceAccountId: this.serviceAccount.name,
          role: 'roles/iam.workloadIdentityUser',
          member: pulumi.interpolate`principal://iam.googleapis.com/${appPool.name}/subject/${deploySubject(app, environment, operation)}`,
        },
        parent,
      );
    }

    /**
     * The app's registry is the app's, and this says so.
     *
     * It sits in central rather than in the app's own project so that staging and
     * production can share one image — built once, promoted rather than rebuilt —
     * and for no other reason. It is the app's resource lodged in somebody else's
     * project, so the app administers it.
     *
     * Admin, which includes setting its IAM policy. That is what lets an app grant
     * whatever principal pulls its images the right to read them, without this stack
     * knowing or caring what that principal is. A Cloud Run agent today; a Compute
     * service account, a node pool, or something not invented yet tomorrow. Deciding
     * that here would be this stack deciding how an app runs, which is the one thing
     * a project handed over as a blank canvas must not come with.
     *
     * It follows that an app can delete its own images, and that its staging account
     * can reach production's. Both are consequences of the registry being shared
     * between an app's environments, which is the property it exists for.
     */
    new gcp.artifactregistry.RepositoryIamMember(
      `${name}-registry-admin`,
      {
        project: centralProject.projectId,
        location: appImages[app].registry.location,
        repository: appImages[app].registry.name,
        role: 'roles/artifactregistry.admin',
        member: this.serviceAccount.member,
      },
      parent,
    );

    /**
     * The app's own Cloudflare credential, minted here so the app never sees the token
     * this stack holds. One per environment rather than per app, so revoking staging's
     * leaves production alone.
     */
    this.cloudflareToken = new cloudflare.AccountToken(
      name,
      {
        accountId: cloudflareAccountId,
        name,
        policies: [
          {
            effect: 'allow',
            permissionGroups: [{ id: WORKERS_SCRIPTS_WRITE }],
            // Typed as a string despite the schema calling it a json object.
            resources: JSON.stringify({
              [`com.cloudflare.api.account.${cloudflareAccountId}`]: '*',
            }),
          },
        ],
      },
      parent,
    );

    // No blank lines inside this document. ESC strips them when it saves, so one here
    // makes every plan report a change to an environment nobody touched.
    this.environment = new service.Environment(
      name,
      {
        organization: pulumiOrganization,
        project: app,
        name: environment,
        yaml: pulumi
          .all([
            this.project.projectId,
            this.cloudflareToken.value,
            appImages[app].registry.project,
            appImages[app].registry.location,
            appImages[app].registry.repositoryId,
          ])
          .apply(
            ([projectId, apiToken, imageProject, imageLocation, imageRepository]) =>
              new pulumi.asset.StringAsset(`# Carries no Google Cloud credential. Anything here arrives as Pulumi configuration,
# which overrides what a deployment mints for itself — so a login here would silently
# demote every deployment to whichever account it named.
values:
  pulumiConfig:
    # Where this environment's resources belong. Passed down because the identifier is
    # generated here — an app repeating it would be a second copy free to drift.
    gcp:project: ${projectId}
    # Minted for this environment alone, and narrower than the token that minted it: it
    # may replace Worker contents and holds no zone permission of any kind.
    cloudflare:apiToken:
      fn::secret: ${apiToken}
    # The Worker this environment's contents belong to. Its hostname and custom domain
    # are the platform stack's business; only what it returns is the app's.
    ${app}:workerName: ${name}
    ${app}:cloudflareAccountId: ${cloudflareAccountId}
    # Where regional resources belong. One region for everything, so a service and
    # the registry it pulls from are never accidentally an ocean apart.
    gcp:region: ${primaryLocation}
    # Where this app's images live, in the three parts a registry actually has.
    # Passed down because they belong to a project the app cannot see — and passed
    # apart rather than joined, so that whatever needs them can put them together the
    # way its own API asks for them. Naming a registry to IAM and naming one to
    # Docker are different shapes of one fact, and neither is the other's substring
    # by luck.
    ${app}:imageProject: ${imageProject}
    ${app}:imageLocation: ${imageLocation}
    ${app}:imageRepository: ${imageRepository}
`),
          ),
      },
      parent,
    );

    /**
     * How this app's stack runs: pull requests previewed, merges to the default branch
     * applied. Held here rather than in the app repository for the same reason the
     * identity is — the layer above decides what a stack may do and how it gets to do
     * it, and neither belongs in a console where nobody can review it.
     */
    new service.DeploymentSettings(
      name,
      {
        organization: pulumiOrganization,
        project: app,
        stack: environment,

        /**
         * Every deployment installs this program's dependencies before it can plan
         * anything, and there are four of them for every change — a preview of each
         * environment on the pull request, and an update of each on the merge. The
         * install is the same one each time.
         *
         * Only the Pulumi project's own dependencies. Anything a program installs
         * while it runs is its own business and is not covered by this.
         */
        cacheOptions: { enable: true },

        // eslint-disable-next-line typescript/no-deprecated
        github: {
          repository: `${githubOrganization}/${app}`,

          /**
           * Neither environment deploys itself.
           *
           * Both deploying on merge is what made staging decorative. They ran in the
           * same second from the same commit, so nothing staging could discover would
           * reach production in time to stop it — which is worse than having no
           * staging, because it looks like a safety net.
           *
           * The app's repository asks the deploy workflow to run instead, and that
           * deploys staging, checks that it serves what was just deployed, and only
           * then deploys production, with the same commit pinned to both.
           *
           * Previews stay on. A preview is keyed to the branch a pull request is
           * opened against, and it is what an app's required checks read — turning it
           * off would leave a check that never arrives, which blocks a pull request
           * forever rather than failing it.
           */
          deployCommits: false,
          previewPullRequests: true,
        },

        // No `repoUrl`: the service rejects one alongside the GitHub integration, and
        // supplying it instead silently downgrades this to a plain git source.
        sourceContext: { git: { branch: 'refs/heads/main', repoDir: 'infra' } },

        // The deployment's own credentials, whose subject names the stack and the
        // operation, so a run outside the pipeline cannot produce one.
        operationContext: {
          oidc: {
            gcp: {
              projectId: centralProject.number,
              workloadPoolId: appPool.workloadIdentityPoolId,
              providerId: appPoolProvider.workloadIdentityPoolProviderId,
              serviceAccount: this.serviceAccount.email,
            },
          },
        },
      },
      parent,
    );

    this.registerOutputs({
      projectId: this.project.projectId,
      serviceAccountEmail: this.serviceAccount.email,
    });
  }
}

export const appEnvironments: Record<AppEnvironmentKey, AppEnvironment> = byAppEnvironment(
  ({ app, environment, key }) => new AppEnvironment({ app, environment, folder: appFolders[key] }),
);

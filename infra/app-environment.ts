import * as cloudflare from '@pulumi/cloudflare';
import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import * as service from '@pulumi/pulumiservice';
import * as random from '@pulumi/random';
import { appPool, appPoolProvider, escSubject, pulumiOrganization } from './app-identity.ts';
import { centralProject, centralServices } from './central.ts';
import { appFolders } from './folders.ts';
import {
  byAppEnvironment,
  ENVIRONMENT_SHORT_NAMES,
  type App,
  type AppEnvironmentKey,
  type Environment,
} from './model.ts';
import { billingAccount } from './organization.ts';

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
    new gcp.serviceaccount.IAMMember(
      `${name}-workload-identity`,
      {
        serviceAccountId: this.serviceAccount.name,
        role: 'roles/iam.workloadIdentityUser',
        member: pulumi.interpolate`principal://iam.googleapis.com/${appPool.name}/subject/${escSubject(app, environment)}`,
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
            centralProject.number,
            appPool.workloadIdentityPoolId,
            appPoolProvider.workloadIdentityPoolProviderId,
            this.serviceAccount.email,
            this.project.projectId,
            this.cloudflareToken.value,
          ])
          .apply(
            ([projectNumber, workloadPoolId, providerId, serviceAccount, projectId, apiToken]) =>
              new pulumi.asset.StringAsset(`values:
  gcp:
    login:
      fn::open::gcp-login:
        project: ${projectNumber}
        oidc:
          workloadPoolId: ${workloadPoolId}
          providerId: ${providerId}
          serviceAccount: ${serviceAccount}
  pulumiConfig:
    gcp:accessToken: \${gcp.login.accessToken}
    # Where this environment's resources belong. Passed down because the identifier is
    # generated here — an app repeating it would be a second copy free to drift.
    gcp:project: ${projectId}
    # Minted for this environment alone, and narrower than the token that minted it: it
    # may replace Worker contents and holds no zone permission of any kind.
    cloudflare:apiToken:
      fn::secret: ${apiToken}
    # The Worker this environment's contents belong to. Its hostname and route are the
    # platform stack's business; only what it returns is the app's.
    ${app}:workerName: ${name}
  environmentVariables:
    GOOGLE_OAUTH_ACCESS_TOKEN: \${gcp.login.accessToken}
`),
          ),
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

import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import type { AppGcpResources } from './app-gcp.ts';
import { ENVIRONMENT_SHORT_NAMES, type AppEnvironmentPair } from './model.ts';
import { billingAccount } from './organization.ts';
import { adoptableFolder, DEPLOY_OPERATIONS, deploySubject } from './platform-gcp.ts';
import type { PlatformResources } from './platform.ts';

export interface AppEnvGcpResources {
  project: gcp.organizations.Project;
  serviceAccount: gcp.serviceaccount.Account;
}

/** An app environment's Google Cloud: its folder and project, and the account that deploys into it. */
export const provisionAppEnvGcpResources = (
  {
    pair,
    platform,
    appGcp,
  }: { pair: AppEnvironmentPair; platform: PlatformResources; appGcp: AppGcpResources },
  options: pulumi.CustomResourceOptions,
): AppEnvGcpResources => {
  const { app, environment, key: name } = pair;
  const { centralProject, centralServices, appsFolders, appStacksPool } = platform.gcp;

  /**
   * One folder per app per environment. This is the unit delegated to an app: it holds
   * that app's project, and an app may create further projects of its own beside it.
   */
  const folder = adoptableFolder(name, app, appsFolders[environment].name, options);

  const suffix = new random.RandomId(`${name}-project-suffix`, { byteLength: 2 }, options);

  const project = new gcp.organizations.Project(
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
    options,
  );

  const serviceAccount = new gcp.serviceaccount.Account(
    name,
    {
      project: centralProject.projectId,
      accountId: `${app}-${ENVIRONMENT_SHORT_NAMES[environment]}`,
      displayName: `${app} - ${environment}`,
      description: `Deploys ${app} into ${environment}.`,
    },
    { ...options, dependsOn: centralServices },
  );

  new gcp.projects.IAMMember(
    `${name}-owner`,
    {
      project: project.projectId,
      role: 'roles/owner',
      member: serviceAccount.member,
    },
    options,
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
        serviceAccountId: serviceAccount.name,
        role: 'roles/iam.workloadIdentityUser',
        member: pulumi.interpolate`principal://iam.googleapis.com/${appStacksPool.name}/subject/${deploySubject(app, environment, operation)}`,
      },
      options,
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
      location: appGcp.registry.location,
      repository: appGcp.registry.name,
      role: 'roles/artifactregistry.admin',
      member: serviceAccount.member,
    },
    options,
  );

  return { project, serviceAccount };
};

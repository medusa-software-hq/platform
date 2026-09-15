import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import type { App } from './model.ts';
import { githubOrganization, organizationAdmins, primaryLocation } from './organization.ts';
import type { PlatformResources } from './platform.ts';

export interface AppGcpResources {
  registry: gcp.artifactregistry.Repository;

  /** What an image in it is called, up to the name and the tag. */
  path: pulumi.Output<string>;

  pushServiceAccount: gcp.serviceaccount.Account;
}

/**
 * An app's Google Cloud, kept in central: where its images live, what may push them, and what
 * lets its repository ask for a deployment.
 *
 * One registry per app, not per environment, so an image is built once and the same
 * digest is promoted from staging to production. Two registries would mean two builds
 * and no guarantee the thing tested is the thing released.
 *
 * The push identity is the only cloud credential an app's GitHub Actions ever holds.
 * Everything else an app deploys goes through Pulumi Deployments, which federates on its own.
 * The credential is write-only, scoped to one registry: a compromised workflow can push a
 * bad image to that app and nothing more.
 */
export const provisionAppGcpResources = (
  { app, platform }: { app: App; platform: PlatformResources },
  options: pulumi.CustomResourceOptions,
): AppGcpResources => {
  const { centralProject, centralServices, githubActionsPool, deployPool, deployServiceAccount } =
    platform.gcp;

  const inCentral = { ...options, dependsOn: centralServices };

  const registry = new gcp.artifactregistry.Repository(
    app,
    {
      project: centralProject.projectId,
      location: primaryLocation,
      repositoryId: app,
      format: 'DOCKER',
      description: `Container images for ${app}.`,

      // A tag that exists cannot be moved. Without this, anything able to push could
      // replace the image a release is about to pull, under the tag it already trusts.
      dockerConfig: { immutableTags: true },
    },
    inCentral,
  );

  const pushServiceAccount = new gcp.serviceaccount.Account(
    `${app}-push`,
    {
      project: centralProject.projectId,
      accountId: `${app}-push`,
      displayName: `${app} - push`,
      description: `Pushes ${app} images from GitHub Actions.`,
    },
    inCentral,
  );

  new gcp.artifactregistry.RepositoryIamMember(
    `${app}-push-writer`,
    {
      project: centralProject.projectId,
      location: registry.location,
      repository: registry.name,
      role: 'roles/artifactregistry.writer',
      member: pushServiceAccount.member,
    },
    options,
  );

  /**
   * Readable by whoever administers the organization.
   *
   * Central belongs to the account this stack deploys with, so nobody could look at
   * what the pipeline pushed — not the tags, not the digests, not whether an image
   * exists at all. The only way to find out was to read a workflow's log, which is
   * the wrong place to learn what is in a registry.
   *
   * Read and nothing else: what is in there is put there by the push identity, on a
   * merge, and a person reaching past that would be making the registry disagree with
   * the repository.
   */
  new gcp.artifactregistry.RepositoryIamMember(
    `${app}-registry-reader`,
    {
      project: centralProject.projectId,
      location: registry.location,
      repository: registry.name,
      role: 'roles/artifactregistry.reader',
      member: organizationAdmins,
    },
    options,
  );

  // Impersonation, rather than granting the federated principal directly: pushing an
  // image needs an OAuth access token, and those are only issued for a service account.
  new gcp.serviceaccount.IAMMember(
    `${app}-push-workload-identity`,
    {
      serviceAccountId: pushServiceAccount.name,
      role: 'roles/iam.workloadIdentityUser',
      member: pulumi.interpolate`principalSet://iam.googleapis.com/${githubActionsPool.name}/attribute.repository/${githubOrganization}/${app}`,
    },
    options,
  );

  /**
   * The deploy workflow, bound to this app's repository.
   *
   * The pool's condition already admits nothing but the deploy workflow, so this adds
   * the other half: which repositories may call it at all. A repository that is not an
   * app of this organization gets no identity even if it copies the workflow reference
   * exactly.
   */
  new gcp.serviceaccount.IAMMember(
    `${app}-deploy-workload-identity`,
    {
      serviceAccountId: deployServiceAccount.name,
      role: 'roles/iam.workloadIdentityUser',
      member: pulumi.interpolate`principalSet://iam.googleapis.com/${deployPool.name}/attribute.repository/${githubOrganization}/${app}`,
    },
    options,
  );

  return {
    registry,
    path: pulumi.interpolate`${registry.location}-docker.pkg.dev/${centralProject.projectId}/${registry.repositoryId}`,
    pushServiceAccount,
  };
};

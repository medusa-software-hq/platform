import * as pulumi from '@pulumi/pulumi';
import * as service from '@pulumi/pulumiservice';
import type { AppEnvCloudflareResources } from './app-env-cloudflare.ts';
import type { AppEnvGcpResources } from './app-env-gcp.ts';
import type { AppEnvNeonResources } from './app-env-neon.ts';
import type { AppGcpResources } from './app-gcp.ts';
import { cloudflareAccountId, pulumiOrganization } from './config.ts';
import type { AppEnvironmentPair } from './model.ts';
import { githubOrganization, primaryLocation } from './organization.ts';
import { accessIssuer, accessKeysUrl } from './platform-cloudflare.ts';
import type { PlatformResources } from './platform.ts';

/**
 * An app environment in Pulumi Cloud: the ESC environment that hands the app everything made for
 * it, and how its stack is deployed.
 *
 * Last, because it is the one place the other providers' resources meet: what an app is told is
 * a project from Google Cloud, a token from Cloudflare, a database from Neon, and a registry
 * from the app itself.
 */
export const provisionAppEnvPulumiCloudResources = (
  {
    pair,
    platform,
    appGcp,
    gcp,
    cloudflare,
    neon,
  }: {
    pair: AppEnvironmentPair;
    platform: PlatformResources;
    appGcp: AppGcpResources;
    gcp: AppEnvGcpResources;
    cloudflare: AppEnvCloudflareResources;
    neon: AppEnvNeonResources;
  },
  options: pulumi.CustomResourceOptions,
): void => {
  const { app, environment, key: name } = pair;
  const { centralProject, appStacksPool, appStacksPoolProvider } = platform.gcp;

  // No blank lines inside this document. ESC strips them when it saves, so one here
  // makes every plan report a change to an environment nobody touched.
  new service.Environment(
    name,
    {
      organization: pulumiOrganization,
      project: app,
      name: environment,
      yaml: pulumi
        .all([
          gcp.project.projectId,
          cloudflare.apiToken.value,
          appGcp.registry.project,
          appGcp.registry.location,
          appGcp.registry.repositoryId,
          neon.project.id,
          neon.apiKey.key,
          cloudflare.accessApplication.aud,
        ])
        .apply(
          ([
            projectId,
            apiToken,
            imageProject,
            imageLocation,
            imageRepository,
            neonProjectId,
            neonKey,
            authAudience,
          ]) =>
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
    # This environment's database, as a project the app administers rather than as a
    # connection string. The key is Editor on that one project and nothing else, so
    # the app owns its branches, roles and schema, and this stack stays ignorant of
    # what it stores. Assembling a connection string is the app's job, because what
    # shape it wants one in depends on what is connecting.
    ${app}:neonProjectId: ${neonProjectId}
    neon:apiKey:
      fn::secret: ${neonKey}
    # Who this environment's callers are, in what checking them takes rather than in
    # which product signs them in: who issues their tokens, where the keys signing those
    # are published, and which tokens are meant for this environment. None of it is a
    # credential; each only says what a valid one looks like.
    ${app}:authIssuer: ${accessIssuer}
    ${app}:authKeysUrl: ${accessKeysUrl}
    ${app}:authAudience: ${authAudience}
`),
        ),
    },
    options,
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
            workloadPoolId: appStacksPool.workloadIdentityPoolId,
            providerId: appStacksPoolProvider.workloadIdentityPoolProviderId,
            serviceAccount: gcp.serviceAccount.email,
          },
        },
      },
    },
    options,
  );
};

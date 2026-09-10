import * as github from '@pulumi/github';
import * as pulumi from '@pulumi/pulumi';
import { appImages, githubPoolProvider } from './app-images.ts';
import { centralProject } from './central.ts';
import { APPS, type App } from './model.ts';
import { githubOrganization } from './organization.ts';

/**
 * An app's repository, and what its workflows need to know.
 *
 * This stack guarantees the repository exists and tells it where to push images. It
 * does not shape it: visibility, merge strategy, branch protection and the rest are
 * the repository's own business, applied by the configure-repo action from the
 * workflows it actually has. Declaring them here as well would give one truth two
 * owners, each undoing the other on its next run.
 */

const config = new pulumi.Config();

/**
 * Authenticates as the GitHub App, never as an ambient token.
 *
 * The provider falls back to `GITHUB_TOKEN` when `token` is unset, and Pulumi
 * Deployments puts a short-lived one in the runner because this stack has the GitHub
 * integration enabled. That token would land in provider inputs and differ on every
 * run, so every plan would carry a phantom change. Zygote blanks the variable in the
 * environment it writes for this stack, which the provider reads as unset.
 */
export const githubProvider = new github.Provider('github', {
  owner: githubOrganization,
  appAuth: {
    id: config.require('githubAppId'),
    installationId: config.require('githubAppInstallationId'),
    pemFile: config.requireSecret('githubAppPrivateKey'),
  },
});

/** Settings the configure-repo action owns. Listed so the boundary is visible. */
const CONFIGURED_ELSEWHERE = [
  'visibility',
  'isTemplate',
  'hasIssues',
  'hasProjects',
  'hasWiki',
  'hasDiscussions',
  'allowMergeCommit',
  'allowSquashMerge',
  'allowRebaseMerge',
  'allowAutoMerge',
  'allowForking',
  'deleteBranchOnMerge',
];

const forApp = (app: App): github.Repository => {
  const repository = new github.Repository(
    app,
    { name: app },
    {
      provider: githubProvider,
      ignoreChanges: CONFIGURED_ELSEWHERE,
      // Repositories predating this stack are adopted rather than recreated.
      import: app,
    },
  );

  const images = appImages[app];

  const variable = (name: string, value: pulumi.Input<string>): github.ActionsVariable =>
    new github.ActionsVariable(
      `${app}-${name}`,
      { repository: repository.name, variableName: name, value },
      { provider: githubProvider },
    );

  variable(
    'IMAGE_REGISTRY',
    pulumi.interpolate`${images.registry.location}-docker.pkg.dev/${centralProject.projectId}/${images.registry.repositoryId}`,
  );
  variable('GCP_IMAGE_PUSH_PROVIDER', githubPoolProvider.name);
  variable('GCP_IMAGE_PUSH_SERVICE_ACCOUNT', images.pushServiceAccount.email);

  return repository;
};

export const appRepositories: Record<App, github.Repository> = Object.fromEntries(
  APPS.map((app) => [app, forApp(app)]),
) as Record<App, github.Repository>;

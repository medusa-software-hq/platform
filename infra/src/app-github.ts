import * as github from '@pulumi/github';
import type * as pulumi from '@pulumi/pulumi';
import type { AppGcpResources } from './app-gcp.ts';
import { pulumiOrganization } from './config.ts';
import type { App } from './model.ts';
import type { PlatformResources } from './platform.ts';

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

/**
 * An app's repository, and what its workflows need to know.
 *
 * This stack guarantees the repository exists and tells it where to push images. It
 * does not shape it: visibility, merge strategy, branch protection and the rest are
 * the repository's own business, applied by the configure-repo action from the
 * workflows it actually has. Declaring them here as well would give one truth two
 * owners, each undoing the other on its next run.
 */
export const provisionAppGithubResources = (
  { app, platform, appGcp }: { app: App; platform: PlatformResources; appGcp: AppGcpResources },
  options: pulumi.CustomResourceOptions,
): void => {
  const onGithub = { ...options, provider: platform.github.provider };
  const { deployIdentity, githubActionsPoolProvider } = platform.gcp;

  const repository = new github.Repository(
    app,
    { name: app },
    {
      ...onGithub,
      ignoreChanges: CONFIGURED_ELSEWHERE,
      // Repositories predating this stack are adopted rather than recreated.
      import: app,
    },
  );

  const variable = (name: string, value: pulumi.Input<string>): github.ActionsVariable =>
    new github.ActionsVariable(
      `${app}-${name}`,
      { repository: repository.name, variableName: name, value },
      onGithub,
    );

  variable('IMAGE_REGISTRY', appGcp.path);
  variable('GCP_IMAGE_PUSH_PROVIDER', githubActionsPoolProvider.name);
  variable('GCP_IMAGE_PUSH_SERVICE_ACCOUNT', appGcp.pushServiceAccount.email);

  // Which Pulumi organization its stacks live in. The app names its own project and
  // its own stacks — those are in its repository — but not the organization holding
  // them, which is this stack's to know.
  variable('PULUMI_ORGANIZATION', pulumiOrganization);

  // How its deploy workflow reaches the Pulumi credential: an identity to federate
  // into, an account to become, and a secret to read. None of the three is a secret
  // itself, and none is usable without an assertion this stack's provider accepts.
  variable('DEPLOY_IDENTITY_PROVIDER', deployIdentity.provider);
  variable('DEPLOY_SERVICE_ACCOUNT', deployIdentity.serviceAccount);
  variable('DEPLOY_TOKEN_SECRET', deployIdentity.secret);
  // And how, having deployed, it gets past the sign-in in front of the app to see it answer.
  variable('DEPLOY_SMOKE_TEST_SECRET', deployIdentity.smokeTestSecret);
};

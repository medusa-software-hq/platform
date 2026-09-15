import * as github from '@pulumi/github';
import { githubApp } from './config.ts';
import { githubOrganization } from './organization.ts';

export interface PlatformGithubResources {
  /** What every app's repository resources are managed through. */
  readonly provider: github.Provider;
}

/** How this stack reaches the organization's repositories. */
export const provisionPlatformGithubResources = (): PlatformGithubResources => {
  /**
   * Authenticates as the GitHub App, never as an ambient token.
   *
   * The provider falls back to `GITHUB_TOKEN` when `token` is unset, and Pulumi
   * Deployments puts a short-lived one in the runner because this stack has the GitHub
   * integration enabled. That token would land in provider inputs and differ on every
   * run, so every plan would carry a phantom change. Zygote blanks the variable in the
   * environment it writes for this stack, which the provider reads as unset.
   */
  const provider = new github.Provider('github', {
    owner: githubOrganization,
    appAuth: {
      id: githubApp.id,
      installationId: githubApp.installationId,
      pemFile: githubApp.privateKey,
    },
  });

  return { provider };
};

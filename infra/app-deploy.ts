import * as github from '@pulumi/github';
import { appRepositories, githubProvider } from './app-repository.ts';
import { APPS, type App } from './model.ts';

/**
 * Where an app's repository keeps the credential it deploys with.
 *
 * An app deploys its environments in the order it decides, which means something in
 * its repository has to be able to start a deployment, which means holding a Pulumi
 * credential. This account can issue only personal access tokens — it is a personal
 * account rather than an organization, so it has neither teams nor organization
 * tokens — and a personal token carries the whole account: every stack, including the
 * ones that grant this one its own rights.
 *
 * Nothing available makes that token narrower. What is available is making it
 * reachable from less. A GitHub environment holds the secret, and only jobs running
 * on the default branch may name that environment, so using the token requires a
 * merge — which already requires a reviewed pull request with every check passing.
 * The bar to use it is the same bar as deploying, which is the bar it is for.
 *
 * That is a bound on who can reach it, not on what it can do. What it can do closes
 * only by this account becoming a real organization.
 */

/** Named by the app's workflow, which is what makes the branch rule apply to it. */
const DEPLOY_ENVIRONMENT = 'deploy';

/** The only branch that may name it. */
const DEPLOYS_FROM = 'main';

/**
 * The secret itself is set by hand, in this environment, and deliberately not here.
 *
 * A personal access token is minted by a person in the Pulumi console; there is no
 * API this stack could call to create one. Writing the value into this program would
 * also put it in this stack's state and in every plan that reads it — for a credential
 * that can read every other secret this organization holds, that is the wrong place.
 */
export const deployTokenSecretName = 'PULUMI_DEPLOY_TOKEN';

const forApp = (app: App): github.RepositoryEnvironment => {
  const repository = appRepositories[app].name;

  const environment = new github.RepositoryEnvironment(
    `${app}-deploy`,
    {
      repository,
      environment: DEPLOY_ENVIRONMENT,

      // Branch patterns, rather than "protected branches". The default branch is
      // protected by a ruleset rather than by a branch protection rule, and the two
      // are not the same thing to this setting.
      deploymentBranchPolicy: { customBranchPolicies: true, protectedBranches: false },

      // The point of the environment is that the token is unreachable from anywhere
      // but the default branch. An exemption for whoever is an admin today would be
      // an exemption for whoever is an admin later.
      canAdminsBypass: false,
    },
    { provider: githubProvider },
  );

  new github.RepositoryEnvironmentDeploymentPolicy(
    `${app}-deploy-branch`,
    { repository, environment: environment.environment, branchPattern: DEPLOYS_FROM },
    { provider: githubProvider },
  );

  return environment;
};

export const appDeployEnvironments: Record<App, github.RepositoryEnvironment> = Object.fromEntries(
  APPS.map((app) => [app, forApp(app)]),
) as Record<App, github.RepositoryEnvironment>;

/** For the app's workflow to name, and for a person to put the token in. */
export const deployEnvironmentName = DEPLOY_ENVIRONMENT;

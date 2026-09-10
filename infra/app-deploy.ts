import * as github from '@pulumi/github';
import * as service from '@pulumi/pulumiservice';
import { pulumiOrganization } from './app-identity.ts';
import { appRepositories, githubProvider } from './app-repository.ts';
import { APPS, type App } from './model.ts';

/**
 * What an app needs in order to deploy itself, in the order it has decided on.
 *
 * Neither of an app's stacks deploys on merge. Its repository runs the whole
 * sequence — staging first, then a check that staging serves what was just deployed,
 * then production with the same commit pinned. That is a program rather than a set of
 * triggers, and the thing running it has to be able to start a deployment.
 */

/**
 * Wider than it should be, and knowingly so.
 *
 * Pulumi scopes tokens to teams, and teams are a paid plan feature this organization
 * does not have. The narrowest thing available is an organization token, which can
 * start a deployment of any stack here — including this one.
 *
 * What bounds it is everything around it, none of which this token can reach. It is
 * not an admin token, so it cannot change a stack's program or its deployment
 * settings. A deployment runs as the identity those settings name rather than as
 * whoever asked for it, so starting one grants nothing. And `destroy` has no identity
 * bound to it anywhere in this organization, so a destroy started with this would run
 * without credentials and fail. The worst it can do to a stack that is not its own is
 * make that stack apply what is already committed to it.
 *
 * That is a bound on the damage, not a defence against the hole. The hole closes by
 * paying for teams.
 */
const ADMIN = false;

const forApp = (app: App): service.OrgAccessToken => {
  const name = `${app}-deploy`;

  const token = new service.OrgAccessToken(name, {
    organizationName: pulumiOrganization,
    name,
    description: `Lets ${app}'s repository deploy ${app}, in the order it decides.`,
    admin: ADMIN,
  });

  new github.ActionsSecret(
    `${app}-deploy-token`,
    {
      repository: appRepositories[app].name,
      secretName: 'PULUMI_DEPLOY_TOKEN',
      value: token.value,
    },
    { provider: githubProvider },
  );

  return token;
};

export const appDeployTokens: Record<App, service.OrgAccessToken> = Object.fromEntries(
  APPS.map((app) => [app, forApp(app)]),
) as Record<App, service.OrgAccessToken>;

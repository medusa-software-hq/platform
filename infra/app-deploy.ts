import * as github from '@pulumi/github';
import * as service from '@pulumi/pulumiservice';
import { pulumiOrganization } from './app-identity.ts';
import { appRepositories, githubProvider } from './app-repository.ts';
import { APPS, ENVIRONMENTS, type App } from './model.ts';

/**
 * What an app needs in order to deploy itself, in the order it has decided on.
 *
 * Neither of an app's stacks deploys on merge. Its repository does the whole
 * sequence — staging first, then a check that staging serves what was just deployed,
 * then production with the same commit pinned. That is a program rather than a set of
 * triggers, and the thing running it needs to be able to start a deployment of either
 * stack.
 *
 * So it is given exactly that, and nothing more: two stacks it may deploy, and no
 * visibility into anything else in the organization.
 */

/**
 * `Edit`, deliberately, and not `Admin`.
 *
 * Admin on a stack includes rewriting its deployment settings — the source, the
 * pre-run commands, and the OIDC configuration that decides which Google Cloud
 * account a deployment runs as. An app able to rewrite those could describe itself as
 * something else and redeploy, which would undo every boundary this stack draws.
 *
 * Starting a deployment is not affected: the identity it runs as is minted from the
 * settings, which this cannot change.
 */
const PERMISSION = service.TeamStackPermissionScope.Edit;

/**
 * A team with no members, existing only to be something a token can be scoped to.
 * Pulumi scopes tokens to teams rather than to stacks, so a team is the shape this
 * permission has to take.
 */
const forApp = (app: App): service.TeamAccessToken => {
  const name = `${app}-deploy`;

  const team = new service.Team(name, {
    organizationName: pulumiOrganization,
    name,
    teamType: 'pulumi',
    displayName: `${app} deploy`,
    description: `Deploys ${app}, in the order its repository decides. Holds no members.`,
  });

  // The team's own name is optional in the schema and so arrives as possibly absent.
  // The constant is what was asked for; the dependency is what makes the order right.
  const afterTheTeam = { dependsOn: team };

  for (const environment of ENVIRONMENTS) {
    new service.TeamStackPermission(
      `${name}-${environment}`,
      {
        organization: pulumiOrganization,
        project: app,
        stack: environment,
        team: name,
        permission: PERMISSION,
      },
      afterTheTeam,
    );
  }

  const token = new service.TeamAccessToken(
    name,
    {
      organizationName: pulumiOrganization,
      teamName: name,
      name,
      description: `Lets ${app}'s repository deploy ${app}.`,
    },
    afterTheTeam,
  );

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

export const appDeployTokens: Record<App, service.TeamAccessToken> = Object.fromEntries(
  APPS.map((app) => [app, forApp(app)]),
) as Record<App, service.TeamAccessToken>;

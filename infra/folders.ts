import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';

/**
 * The folder hierarchy.
 *
 *   <delegation folder>/
 *   ├── shared/                      the central project
 *   └── environments/
 *       ├── production/apps/<app>/
 *       └── staging/apps/<app>/
 *
 * Environment-major on purpose. A single `production` folder means a new app cannot
 * land in production without inheriting whatever policy sits there — inheritance is
 * fail-closed this way round. App-major would make per-app delegation one grant
 * instead of two, at the cost of an app nobody remembered to stamp inheriting nothing.
 */

export const ENVIRONMENTS = ['production', 'staging'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const APPS = ['demo'] as const;
export type App = (typeof APPS)[number];

const config = new pulumi.Config();

/** Folder the bootstrap stack delegates to this one, as `folders/<id>`. */
const delegationFolder = config.require('delegationFolder');

/**
 * Folders that predate this program, from the Terraform era. Adopting them keeps the
 * projects inside where they are; recreating the tree would strand them.
 *
 * Remove an entry once the first successful `up` has adopted it — Pulumi verifies the
 * identifier on every subsequent operation, so a stale entry is noise at best.
 */
const ADOPT: Readonly<Record<string, string>> = {
  shared: 'folders/485336689789',
  environments: 'folders/806881350507',
  production: 'folders/525971717005',
  staging: 'folders/750288711492',
  'production-apps': 'folders/347028805386',
  'staging-apps': 'folders/974486982411',
  'demo-production': 'folders/566356451684',
  'demo-staging': 'folders/828221816233',
};

const adopt = (name: string): pulumi.CustomResourceOptions => {
  const id = ADOPT[name];
  return id === undefined ? {} : { import: id };
};

const byEnvironment = <T>(make: (environment: Environment) => T): Record<Environment, T> =>
  Object.fromEntries(ENVIRONMENTS.map((environment) => [environment, make(environment)])) as Record<
    Environment,
    T
  >;

const folder = (name: string, displayName: string, parent: pulumi.Input<string>) =>
  new gcp.organizations.Folder(name, { displayName, parent }, adopt(name));

/** Holds the central project: shared state and registries, nothing app-specific. */
export const sharedFolder = folder('shared', 'shared', delegationFolder);

const environmentsFolder = folder('environments', 'environments', delegationFolder);

const environmentFolders = byEnvironment((environment) =>
  folder(environment, environment, environmentsFolder.name),
);

/** Leaves room beside `apps` for anything that is environment-scoped but not an app. */
const appsFolders = byEnvironment((environment) =>
  folder(`${environment}-apps`, 'apps', environmentFolders[environment].name),
);

/**
 * One folder per app per environment. This is the unit delegated to an app: it holds
 * that app's project, and an app may create further projects of its own beside it.
 */
export const appFolders = Object.fromEntries(
  APPS.flatMap((app) =>
    ENVIRONMENTS.map(
      (environment) =>
        [
          `${app}-${environment}`,
          folder(`${app}-${environment}`, app, appsFolders[environment].name),
        ] as const,
    ),
  ),
) as Record<`${App}-${Environment}`, gcp.organizations.Folder>;

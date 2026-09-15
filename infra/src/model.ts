/**
 * What this organization has. Adding an app is a one-line change here; everything that
 * follows — folders, projects, identities — is derived from it.
 */

/** The organization's Internet domain, and the name of its Cloud Identity account. */
export const organizationDomain = 'medusa.software';

export const ENVIRONMENTS = ['production', 'staging'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Terse forms, for identifiers with length limits: project IDs and hostnames. */
export const ENVIRONMENT_SHORT_NAMES: Readonly<Record<Environment, string>> = {
  production: 'prod',
  staging: 'stg',
};

export const APPS = ['demo'] as const;
export type App = (typeof APPS)[number];

export type AppEnvironmentKey = `${App}-${Environment}`;

export const appEnvironmentKey = (app: App, environment: Environment): AppEnvironmentKey =>
  `${app}-${environment}`;

export interface AppEnvironmentPair {
  app: App;
  environment: Environment;
  key: AppEnvironmentKey;
}

/** Every app in every environment, in a stable order. */
export const appEnvironments = (): AppEnvironmentPair[] =>
  APPS.flatMap((app) =>
    ENVIRONMENTS.map((environment) => ({
      app,
      environment,
      key: appEnvironmentKey(app, environment),
    })),
  );

export const byEnvironment = <T>(make: (environment: Environment) => T): Record<Environment, T> =>
  Object.fromEntries(ENVIRONMENTS.map((environment) => [environment, make(environment)])) as Record<
    Environment,
    T
  >;

export const byAppEnvironment = <T>(
  make: (pair: AppEnvironmentPair) => T,
): Record<AppEnvironmentKey, T> =>
  Object.fromEntries(appEnvironments().map((pair) => [pair.key, make(pair)])) as Record<
    AppEnvironmentKey,
    T
  >;

/**
 * Where an app environment answers. Production is served bare; every other
 * environment is suffixed with its own name.
 */
export const hostnameFor = ({ app, environment }: AppEnvironmentPair): string =>
  `${environment === 'production' ? app : `${app}-${environment}`}.${organizationDomain}`;

/**
 * The order environments are deployed in, which is the whole of what "staging" means.
 *
 * Separate from {@link ENVIRONMENTS} because that one is a set and this one is a
 * sequence: iterating the set to create projects may happen in any order, and
 * iterating this one may not.
 */
export const DEPLOY_ORDER: readonly Environment[] = ['staging', 'production'];

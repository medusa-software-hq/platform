import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import { appFolders } from './folders.ts';
import {
  byAppEnvironment,
  ENVIRONMENT_SHORT_NAMES,
  type App,
  type AppEnvironmentKey,
  type Environment,
} from './model.ts';
import { billingAccount } from './organization.ts';

interface AppEnvironmentArgs {
  app: App;
  environment: Environment;
  folder: gcp.organizations.Folder;
}

/**
 * One app in one environment.
 *
 * Its own project, inside its own folder, so an app is a subtree rather than pieces
 * scattered across shared ones — removing it is removing the folder, not hunting.
 *
 * The identity that deploys into this project deliberately does not live here. An app
 * holds broad rights inside its own project, so an account kept alongside would be one
 * the app could rewrite; it belongs in a project this stack owns instead.
 */
export class AppEnvironment extends pulumi.ComponentResource {
  readonly project: gcp.organizations.Project;

  constructor(
    { app, environment, folder }: AppEnvironmentArgs,
    options?: pulumi.ComponentResourceOptions,
  ) {
    const name = `${app}-${environment}`;
    super('medusa:platform:AppEnvironment', name, {}, options);

    const suffix = new random.RandomId(
      `${name}-project-suffix`,
      { byteLength: 2 },
      { parent: this },
    );

    this.project = new gcp.organizations.Project(
      name,
      {
        // Parentheses are rejected; the allowed set is letters, digits, hyphen,
        // quotes, space and exclamation mark.
        name: `${app} - ${environment}`,
        projectId: suffix.hex.apply(
          (hex) => `ms-${app}-${ENVIRONMENT_SHORT_NAMES[environment]}-${hex}`,
        ),
        folderId: folder.folderId,
        billingAccount: billingAccount.id,

        // Exploration phase: `destroy` should actually destroy.
        deletionPolicy: 'DELETE',
      },
      { parent: this },
    );

    this.registerOutputs({ projectId: this.project.projectId });
  }
}

export const appEnvironments: Record<AppEnvironmentKey, AppEnvironment> = byAppEnvironment(
  ({ app, environment, key }) => new AppEnvironment({ app, environment, folder: appFolders[key] }),
);

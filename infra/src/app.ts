import * as pulumi from '@pulumi/pulumi';
import { AppEnv } from './app-env.ts';
import { provisionAppGcpResources } from './app-gcp.ts';
import { provisionAppGithubResources } from './app-github.ts';
import { ENVIRONMENTS, type App } from './model.ts';
import type { PlatformResources } from './platform.ts';

interface AppArgs {
  app: App;
  platform: PlatformResources;
}

/**
 * One app: what it has once, whatever the environment, and each of its environments.
 *
 * A component so that everything belonging to an app is one subtree of the stack — read
 * together in a plan, and depended on as a whole. What it is made of lives in one file per
 * provider; this only decides that an app has them, and what each needs from the others.
 *
 * Once per app rather than per environment: its image registry, so one build is promoted from
 * staging to production; its repository, and what that repository's workflows are told; and
 * the binding that lets its repository ask for a deployment.
 */
export class AppComponent extends pulumi.ComponentResource {
  constructor({ app, platform }: AppArgs, options?: pulumi.ComponentResourceOptions) {
    super('medusa:platform:App', app, {}, options);

    const children = { parent: this };

    const gcp = provisionAppGcpResources({ app, platform }, children);

    provisionAppGithubResources({ app, platform, appGcp: gcp }, children);

    for (const environment of ENVIRONMENTS) {
      new AppEnv({ app, environment, platform, appGcp: gcp }, children);
    }

    this.registerOutputs({});
  }
}

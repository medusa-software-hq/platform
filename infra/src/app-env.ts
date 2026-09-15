import * as pulumi from '@pulumi/pulumi';
import { provisionAppEnvCloudflareResources } from './app-env-cloudflare.ts';
import { provisionAppEnvGcpResources } from './app-env-gcp.ts';
import { provisionAppEnvNeonResources } from './app-env-neon.ts';
import { provisionAppEnvPulumiCloudResources } from './app-env-pulumi-cloud.ts';
import type { AppGcpResources } from './app-gcp.ts';
import { appEnvironmentKey, type App, type Environment } from './model.ts';
import type { PlatformResources } from './platform.ts';

interface AppEnvArgs {
  app: App;
  environment: Environment;
  platform: PlatformResources;
  /** The app's Google Cloud, whose image registry every environment of the app pulls from. */
  appGcp: AppGcpResources;
}

/**
 * One app in one environment: its project, the account that deploys into it, and the
 * environment that account is reached through.
 *
 * The project sits in its own folder, so an app is a subtree rather than pieces
 * scattered across shared ones. The account deliberately does not: an app holds broad
 * rights inside its project, so an account kept there would be one it could rewrite.
 * It lives in central, which apps cannot write to.
 *
 * `roles/owner` on its own project, rather than an enumerated list. The list was the
 * wrong granularity — needing a Pub/Sub topic should not be a change to this repository
 * — and it was never a real bound anyway, since any role permitting `setIamPolicy`
 * lets the holder widen it. The actual bound is the service policy the bootstrap stack
 * sets above these folders, which nothing here can override.
 *
 * What it is made of lives in one file per provider. The Pulumi Cloud environment comes last,
 * because it is where everything the others made is handed to the app.
 */
export class AppEnv extends pulumi.ComponentResource {
  constructor(
    { app, environment, platform, appGcp }: AppEnvArgs,
    options?: pulumi.ComponentResourceOptions,
  ) {
    const key = appEnvironmentKey(app, environment);

    // The type predates the file's name, and stays: it is part of every URN beneath this.
    super('medusa:platform:AppEnvironment', key, {}, options);

    const children = { parent: this };
    const pair = { app, environment, key };

    const gcp = provisionAppEnvGcpResources({ pair, platform, appGcp }, children);

    const cloudflare = provisionAppEnvCloudflareResources({ pair, platform }, children);

    const neon = provisionAppEnvNeonResources({ pair }, children);

    provisionAppEnvPulumiCloudResources(
      { pair, platform, appGcp, gcp, cloudflare, neon },
      children,
    );

    this.registerOutputs({});
  }
}

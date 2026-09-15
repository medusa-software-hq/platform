import { AppComponent } from './app.ts';
import { APPS } from './model.ts';
import { provisionPlatformCloudflareResources } from './platform-cloudflare.ts';
import { provisionPlatformGcpResources } from './platform-gcp.ts';
import { provisionPlatformGithubResources } from './platform-github.ts';
import type { PlatformResources } from './platform.ts';

/**
 * The platform: what exists once whatever the app, and every app, each with its environments.
 *
 * Cloudflare before Google Cloud, because central keeps the secret of a token Access issues.
 *
 * Nothing is exported. No other stack or program reads this one's outputs: an app is told what it
 * needs through its ESC environment and its repository's variables, and the deploy workflow reads
 * the model directly.
 */

const cloudflare = provisionPlatformCloudflareResources();
const gcp = provisionPlatformGcpResources({ cloudflare });
const github = provisionPlatformGithubResources();

const platform: PlatformResources = { gcp, cloudflare, github };

for (const app of APPS) {
  new AppComponent({ app, platform });
}

import type { PlatformCloudflareResources } from './platform-cloudflare.ts';
import type { PlatformGcpResources } from './platform-gcp.ts';
import type { PlatformGithubResources } from './platform-github.ts';

/** What exists once for the whole platform, whatever the app, by provider. */
export interface PlatformResources {
  readonly gcp: PlatformGcpResources;
  readonly cloudflare: PlatformCloudflareResources;
  readonly github: PlatformGithubResources;
}

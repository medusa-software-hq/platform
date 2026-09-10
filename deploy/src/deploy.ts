// The file, not the directory. `@pulumi/pulumi` declares neither `main` nor an
// `exports` map, so from an ES module `@pulumi/pulumi/automation` is a directory
// import — which Node refuses, at run time, with `ERR_UNSUPPORTED_DIR_IMPORT`.
import { RemoteWorkspace } from '@pulumi/pulumi/automation/index.js';
import { requireEnvironment } from './environment.ts';

/**
 * One environment's deployment, awaited.
 *
 * The work happens in Pulumi Deployments, on the same runner and with the same
 * identity a deployment triggered any other way would have — the only difference is
 * that this one was asked for, and its result comes back to whoever asked. That is
 * the whole reason the order can be written down as a sequence of statements instead
 * of assembled out of triggers and webhooks.
 */

export const deploy = async (app: string, stack: string, commit: string): Promise<void> => {
  const organization = requireEnvironment('PULUMI_ORGANIZATION');

  const remote = await RemoteWorkspace.createOrSelectStack(
    {
      stackName: `${organization}/${app}/${stack}`,

      // The commit, not the branch. Production must deploy what staging was just
      // shown to serve, and by the time it does, the branch may have moved on.
      commitHash: commit,
    },
    {
      // Defaults to false, which would mean *replacing* the stack's saved deployment
      // settings with these — the source, and the OIDC configuration that decides
      // which account the deployment runs as. The run would then have no identity at
      // all. There is no reason to ever want that here.
      inheritSettings: true,
    },
  );

  const { summary } = await remote.up({
    onOutput: (output) => process.stdout.write(output),
  });

  if (summary.result !== 'succeeded') {
    throw new Error(`Deploying ${app}/${stack} ended as ${summary.result}`);
  }
};

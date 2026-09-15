import * as pulumi from '@pulumi/pulumi';

/**
 * Where everything app-shaped used to be: directly under the stack, before apps and their
 * environments were components.
 *
 * Spread into the options of each resource that changed position, so Pulumi recognises it under
 * its new URN instead of planning a delete and a create. Temporary: once the stack has been
 * updated with this, state holds the new URNs, and this file and every use of it are removed.
 */
export const movedFromStackRoot: pulumi.ResourceOptions = {
  aliases: [{ parent: pulumi.rootStackResource }],
};

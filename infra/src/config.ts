import * as pulumi from '@pulumi/pulumi';

/**
 * Everything this stack is configured with, read once.
 *
 * The values arrive from the ESC environment the bootstrap stack writes for this stack. Reading
 * them here and nowhere else keeps configuration at the edge: every other module imports the
 * value it needs rather than reaching into Pulumi's configuration for itself, so a key that is
 * renamed or goes missing is found in one place.
 */

const config = new pulumi.Config();

/** Folder the bootstrap stack delegates to this one, as `folders/<id>`. */
export const delegationFolder = config.require('delegationFolder');

/** Pulumi Cloud organization, which is also the audience it issues tokens for. */
export const pulumiOrganization = config.require('pulumiOrganization');

/** The Cloudflare account every Worker, token and Access resource belongs to. */
export const cloudflareAccountId = config.require('cloudflareAccountId');

/** The secret of the OAuth client Access signs people in to Google Workspace through. */
export const accessIdentityProviderClientSecret = config.requireSecret(
  'accessIdentityProviderClientSecret',
);

/** The GitHub App this stack acts as in the organization's repositories. */
export const githubApp = {
  id: config.require('githubAppId'),
  installationId: config.require('githubAppInstallationId'),
  privateKey: config.requireSecret('githubAppPrivateKey'),
};

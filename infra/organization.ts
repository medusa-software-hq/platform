import * as gcp from '@pulumi/gcp';
import { organizationDomain } from './model.ts';

export { organizationDomain };

/** Where regional resources live unless something argues otherwise. */
export const primaryLocation = 'europe-west1';

/**
 * Who administers this organization, as a group rather than as people.
 *
 * Which people hold a role is a property of the organization, not of a program:
 * naming one here would make a deployment the way to change who somebody is, and
 * leave an identity that outlives its holder. Membership changes instead.
 */
export const organizationAdmins = `group:gcp-organization-admins@${organizationDomain}`;

/** The GitHub organization that owns every repository this stack provisions. */
export const githubOrganization = 'medusa-software-hq';

/**
 * The Neon organization whose projects back app databases.
 *
 * Written here rather than carried in the environment that holds the Neon key. It is
 * an identifier, not a credential — it grants nothing on its own, and a reader of this
 * program should be able to see which organization is meant without opening a secrets
 * store. The key stays where credentials go.
 */
export const neonOrganization = 'org-patient-shadow-78024621';

/**
 * The Cloudflare Zero Trust team every app signs people in through, as its login address.
 *
 * Written here rather than managed. A team is created once, by hand, when Zero Trust is
 * enabled on the account — a step that asks for a plan and payment details even when the
 * plan is free — and the provider cannot adopt one afterwards. Everything inside the team
 * is this stack's.
 */
export const accessTeamDomain = 'medusa-software.cloudflareaccess.com';

/**
 * The OAuth client Access signs people in to Google Workspace through.
 *
 * An identifier, so it is written here; the secret it came with is a credential, so it
 * is not. Made in the central project's console, which has no API for OAuth clients.
 */
export const accessIdentityProviderClientId =
  '509429451634-d8ij1r0cvck9lhmc4jdr8qnmj96ov8q5.apps.googleusercontent.com';

export const organization = gcp.organizations.getOrganizationOutput({
  domain: organizationDomain,
});

export const billingAccount = gcp.organizations.getBillingAccountOutput({
  displayName: 'My Billing Account',
  open: true,

  // Enumerating the account's projects needs `billing.resourceAssociations.list`,
  // which `roles/billing.user` does not carry — and nothing here reads the result.
  // The alternative is `roles/billing.viewer`, some sixty permissions covering
  // pricing, spending and carbon reporting, to obtain one that gets discarded.
  lookupProjects: false,
});

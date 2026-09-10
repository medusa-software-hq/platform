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

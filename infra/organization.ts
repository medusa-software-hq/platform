import * as gcp from '@pulumi/gcp';

/** The organization's Internet domain, and the name of its Cloud Identity account. */
export const organizationDomain = 'medusa.software';

/** Where regional resources live unless something argues otherwise. */
export const primaryLocation = 'europe-west1';

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

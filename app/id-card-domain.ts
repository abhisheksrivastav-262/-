export type PublicMembershipStatus = 'Active' | 'Suspended' | 'Inactive' | 'Invalid';

export type MembershipStatusInput = {
  hasCard: boolean;
  revoked: boolean;
  memberStatus: string | null | undefined;
  accountStatus: string | null | undefined;
  profileActive: boolean | null | undefined;
  cardValidUntil?: string | null;
  memberValidUntil?: string | null;
  today?: string;
};

export function canIssueMembershipCard(memberStatus: string | null | undefined, membershipNo: string | null | undefined) {
  return memberStatus === 'approved' && Boolean(membershipNo?.trim());
}

export function deriveMembershipStatus(input: MembershipStatusInput): PublicMembershipStatus {
  if (!input.hasCard) return 'Invalid';
  if (input.memberStatus === 'blocked' || input.accountStatus === 'suspended') return 'Suspended';
  if (input.memberStatus !== 'approved' || input.accountStatus !== 'active' || input.profileActive !== true) {
    return 'Inactive';
  }
  if (input.revoked) return 'Invalid';

  const today = input.today || new Date().toISOString().slice(0, 10);
  if ([input.cardValidUntil, input.memberValidUntil].some((date) => Boolean(date && date < today))) {
    return 'Inactive';
  }
  return 'Active';
}

export function getVerificationUrl(token: string, siteUrl = 'https://www.vdssamiti.com') {
  return `${siteUrl.replace(/\/+$/, '')}/verify/${encodeURIComponent(token)}`;
}

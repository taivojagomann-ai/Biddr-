import { Building2, ShieldCheck, User } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import { HELP } from "@/lib/help";
import { ContactSellerButton, type ContactLink } from "@/components/auction/contact-seller";
import { LocalDateTime } from "@/components/local-date-time";
import { COUNTRY_NAMES } from "@/lib/countries";
import type { Country } from "@/lib/types";

/** What buyers may see about a seller (DECISIONS.md, point 10). Never full name, phone or email. */
export interface SellerInfo {
  username: string | null;
  country: Country | null;
  /** profiles.created_at */
  memberSince: string | null;
  sellerType: "private" | "dealer";
  dealerName: string | null;
  dealerRegistryCode: string | null;
  /** Cars this seller has had scheduled, live or finished on Biddr. */
  listed: number;
  sold: number;
  /** Identity verified with Stripe Identity (DECISIONS.md point 16). */
  verified?: boolean;
}

export function SellerCard({ seller, contact = null }: { seller: SellerInfo; contact?: ContactLink | null }) {
  const dealer = seller.sellerType === "dealer";
  return (
    <section aria-labelledby="seller-heading" className="rounded-lg border border-line bg-panel p-4">
      <h2 id="seller-heading" className="mb-3 text-lg font-bold">
        Seller
      </h2>
      <div className="flex items-start gap-3">
        {dealer ? (
          <Building2 aria-hidden className="mt-0.5 size-5 shrink-0 text-mute" />
        ) : (
          <User aria-hidden className="mt-0.5 size-5 shrink-0 text-mute" />
        )}
        <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-mute">Username</dt>
            <dd className="font-semibold">
              {seller.username ?? "Member"}
              {seller.verified ? (
                <span className="ml-2 inline-flex items-center gap-0.5 align-middle">
                  <span className="inline-flex items-center gap-1 rounded-sm border border-verified/70 px-1.5 py-0.5 text-xs font-semibold text-verified">
                    <ShieldCheck aria-hidden className="size-3.5" />
                    Verified seller
                  </span>
                  <InfoTip topic={HELP.verifiedSeller} />
                </span>
              ) : null}
            </dd>
          </div>
          {seller.country ? (
            <div>
              <dt className="text-mute">Country</dt>
              <dd className="font-semibold">{COUNTRY_NAMES[seller.country]}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-mute">Seller</dt>
            <dd className="font-semibold">
              {dealer ? (
                <>
                  Dealer{seller.dealerName ? `: ${seller.dealerName}` : ""}
                  {seller.dealerRegistryCode ? (
                    <span className="block font-normal text-mute">Registry code {seller.dealerRegistryCode}</span>
                  ) : null}
                </>
              ) : (
                "Private seller"
              )}
            </dd>
          </div>
          {seller.memberSince ? (
            <div>
              <dt className="text-mute">Member since</dt>
              <dd className="font-semibold">
                <LocalDateTime iso={seller.memberSince} dateOnly />
              </dd>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <dt className="text-mute">On Biddr</dt>
            <dd className="font-semibold">
              {seller.listed} {seller.listed === 1 ? "car" : "cars"} listed, {seller.sold} sold
            </dd>
          </div>
        </dl>
      </div>
      {contact ? (
        <div className="mt-4 border-t border-line pt-4">
          <ContactSellerButton link={contact} />
          <p className="mt-2 text-xs text-mute">Ask privately or arrange a viewing, test drive or inspection before you bid.</p>
        </div>
      ) : null}
    </section>
  );
}

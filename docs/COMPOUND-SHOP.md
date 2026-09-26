# Compound shop

## Buying compounds

1. Open Simulation and search **Pyxis stock** or **Macrocycles** (All/Real/Virtual).
2. Choose an available pack and **Add to cart**. RPX and VPX offer 1, 2 and 5 mg
   where applicable; stock has the workbook's additional sizes, bounded by the
   source row's available mg. Virtual compounds are labelled made to order.
3. Open the cart, adjust quantities, and **Review order**. The server rechecks
   every signed item and displays the authoritative total.
4. Continue to Stripe, enter billing and delivery information, and pay by card.
   **The card is charged immediately. Shipping is included in listed USD prices.**
5. Return to **Compound orders** for payment status and the saved line items.
   Only verified payment clears the purchased basket entries. A failed or canceled
   checkout preserves the cart. Open compounds/ChEMBL is discovery-only.

Old supplier basket entries cannot be purchased; remove them and search the owned
catalog again. Offers last 24 hours; expired offers require a new search. Orders
contain at most three distinct compounds (source plus row ID), up to ten packs per
line. Multiple pack sizes of one compound count as one distinct compound.

## Price and availability policy

`shared/compoundPriceBook.js` is the shared price book. Only the supplied workbook's
**1–3 compounds** tier is used. Original EUR cells remain visible alongside fixed
USD prices calculated at 1 EUR = 1.1367 USD, with each pack rounded to integer cents.
The resulting USD amount is the sale price, not an informational estimate. Changes
to the price book require a version change and an explicit review before payment.
No Asinex catalog or supplier repricing endpoint participates.

Stock and real-macrocycle quantities and lead times come from the imported files.
They are dated snapshots. Basket validation caps aggregate requested mg against
the snapshot; it does **not** reserve inventory across customers or decrement the
scientific source database. Virtual packs are made to order. Operational stock,
synthesis, delivery and refunds are handled by the merchant after payment.

## Orders and fulfillment

The application stores `compound_orders` in its existing Mongo database, separately
from credit purchases. Each order preserves canonical item/source/row/SMILES/pack,
quantity, original EUR price, USD cents, FX version, Stripe IDs, billing and shipping
contact information, and payment timestamps. The browser only reads orders owned
by its username and company; tenant owner roles do not grant global shop access.

Verified Stripe Checkout events or an authenticated server-side Stripe retrieval
can mark an order paid. Return URL parameters never prove payment. Stripe session
creation is idempotent and persists its exact parameters before the API call. An
uncertain response reuses that request; old uncertain requests require support
review rather than risking a second charge. Paid state cannot regress to unpaid.

Payment leaves `fulfillmentStatus: pending`. Operators use Stripe Dashboard and
trusted database access to arrange fulfillment. There is no automated supplier
ordering, stock reservation, dispatch integration, or shipment tracking in this
slice. Refunds made in Stripe are not yet synchronized into the application order
status. These are operational limitations, not reasons to charge twice or grant
simulation credits for a compound purchase.

## Verification and release

`bun run test:compound-shop` covers signatures, workbook values, stock limits,
HTTP checkout concurrency/retries, ownership, webhook signatures/payment checks,
and client cart lifecycle. `bun run test:catalog-pricing` protects retired catalog
paths and existing one-time credit purchases. The full CI includes shop tests.

For browser testing, search → select pack → add → cart → review can be exercised
without payment. Completing checkout on full staging uses the configured real
Stripe account and real application records. Use the isolated fixture for automated
payment completion; never submit a real card merely to verify code.

Server deployments must include the repository's `shared/` directory. Existing JWT,
Stripe and Mongo configuration are reused; no new credentials are required. Normal
and staging frontends must be built separately, and `/staging/` return URLs must
stay under that prefix. Before accepting payments, verify the Stripe account's
registered `checkout.session.completed` endpoint runs the compound-order handler.
A staging return can reconcile payment, but a production webhook still running old
code cannot update compound orders when the buyer closes the browser. Do not call
that combination a fully released shop. The dataset files and indexes remain on the scientific
host; order snapshots in Mongo are ordinary application records.

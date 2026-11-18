// Time limits around a sale (DECISIONS.md point 12), shared by the server and the browser.

/** How long the winner has to complete a payment that needs them. */
export const PAYMENT_DUE_HOURS = 72;
/** The reminder goes this long before the deadline. */
export const REMINDER_HOURS = 24;
/** How long the next bidder has to accept a second-chance offer and pay. */
export const SECOND_CHANCE_HOURS = 48;
/** How long the buyer has to pay the seller for the car after the premium is paid. */
export const SELLER_PAYMENT_DAYS = 7;

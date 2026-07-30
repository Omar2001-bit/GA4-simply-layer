import { humanize, humanizeEvent } from "./format";
import {
  convRateDenom,
  convRateEventName,
  eventMetricName,
  isConvRateMetric,
  isEventMetric,
  isNegativeEventName,
  metricIsInverted,
} from "./types";

export interface DeltaExplanation {
  what: string; // plain-language definition of the metric/event
  trigger: string; // the specific user action (or calculation) that makes it count
  primary: string; // reason THIS observed direction reads as good or bad — matches the badge color
  caveat: string; // the flip side of the same direction — reason to double-check before taking the color at face value
}

interface DirectionCopy {
  good: string; // framing when this direction is the good news
  bad: string; // framing when this same direction is actually the bad news
}

interface Knowledge {
  what: string;
  trigger: string;
  up: DirectionCopy;
  down: DirectionCopy;
}

// ---- standard GA4 ecommerce events, in funnel order ----
// Each entry gets BOTH a "why this is good" and "why this is bad" reading for
// an increase, and the same for a decrease — real ecommerce metrics rarely
// have a single unambiguous verdict, and the tooltip's whole point is to
// surface the read that matches the badge color plus the honest flip side.
const EVENTS: Record<string, Knowledge> = {
  view_item: {
    what: `Fires when a shopper opens a single product's detail page.`,
    trigger: `Landing on a product page — from search, a category page, an ad, or a direct link.`,
    up: {
      good: `More product views means more shoppers browsing the catalog — the top of the funnel is healthy.`,
      bad: `A spike with no matching rise in add-to-cart or purchases can mean the traffic is low-intent (bots, curiosity clicks from an ad that over-promised), not more real shoppers.`,
    },
    down: {
      good: `Can be fine if purchases are steady or rising — shoppers may be finding what they want faster and browsing fewer products before buying.`,
      bad: `Fewer product views usually means less top-of-funnel traffic reaching products at all — check category pages, search, and ad delivery.`,
    },
  },
  view_item_list: {
    what: `Fires when a shopper views a list of products — a category, search results, or a "related products" module.`,
    trigger: `A product-list component rendering on screen.`,
    up: {
      good: `More list views means more browsing of the catalog as a whole, not just single products found directly.`,
      bad: `A spike here without matching product-detail views can mean shoppers are scrolling past listings without anything catching their eye.`,
    },
    down: {
      good: `Can reflect shoppers arriving with more specific intent (search, direct links) and skipping general browsing.`,
      bad: `Fewer list views usually means less overall catalog exposure.`,
    },
  },
  select_item: {
    what: `Fires when a shopper clicks a product from within a list (category, search results, recommendations).`,
    trigger: `Clicking a product card in a list.`,
    up: {
      good: `More clicks from listings means the products shown there are catching interest.`,
      bad: `Rarely bad on its own — mainly worth checking it's followed through to product views, not just clicks that bounce back.`,
    },
    down: {
      good: `Rarely good on its own.`,
      bad: `Fewer clicks from listings can mean the products or images shown aren't appealing, or the list order needs work.`,
    },
  },
  add_to_cart: {
    what: `Fires when a shopper adds a product (or increases its quantity) to their cart.`,
    trigger: `Clicking "Add to cart" on a product page, a quick-add on a listing, or raising a cart quantity.`,
    up: {
      good: `More adds-to-cart means more purchase intent entering the funnel — usually the first sign a marketing push or product change is working.`,
      bad: `Cart adds rising while checkouts/purchases stay flat is a warning sign: intent is growing, but something later in the funnel (price, shipping cost, a broken checkout) is stopping it from converting.`,
    },
    down: {
      good: `Only reassuring if it tracks a comparable drop in top-of-funnel traffic — fewer visits naturally means fewer adds.`,
      bad: `Fewer adds-to-cart usually means fewer shoppers finding a product worth buying — check product relevance, pricing, and out-of-stock items.`,
    },
  },
  remove_from_cart: {
    what: `Fires when a shopper removes an item (or drops its quantity to zero) from their cart.`,
    trigger: `Clicking "Remove", or dragging a cart quantity to zero, in the cart or checkout.`,
    up: {
      good: `Occasionally healthy: shoppers actively curating a cart (swapping a size/color, clearing a duplicate) rather than abandoning it outright.`,
      bad: `Usually means second thoughts — sticker shock at the subtotal, an unexpected shipping cost, or a change of mind. A rise right before checkout is one of the strongest "something's wrong with pricing or trust" signals.`,
    },
    down: {
      good: `Fewer removals means carts are sticking — whatever's added is staying wanted all the way to checkout.`,
      bad: `Very rarely a bad sign — a drop here is close to strictly good.`,
    },
  },
  view_cart: {
    what: `Fires when a shopper opens their cart page or cart drawer.`,
    trigger: `Clicking the cart icon, or a drawer opening automatically right after an add-to-cart.`,
    up: {
      good: `More cart views usually tracks with more cart activity overall — a healthy signal alongside rising add-to-cart.`,
      bad: `A spike disconnected from add-to-cart growth can mean shoppers are repeatedly re-checking their cart out of price anxiety rather than moving forward.`,
    },
    down: {
      good: `On a drawer-based checkout, a drop can simply mean shoppers are skipping straight to checkout — not necessarily bad.`,
      bad: `Fewer cart views alongside fewer purchases usually just tracks a general drop in engaged shoppers.`,
    },
  },
  begin_checkout: {
    what: `Fires the moment a shopper starts the checkout process from their cart.`,
    trigger: `Clicking "Checkout" from the cart page or cart drawer.`,
    up: {
      good: `More checkouts started means more shoppers are serious about buying — the strongest bottom-of-funnel intent signal short of an actual purchase.`,
      bad: `If checkouts rise but purchases don't follow at the usual rate, the checkout flow itself has likely gotten harder — new friction, a broken field, or a payment option that disappeared.`,
    },
    down: {
      good: `Only reassuring if it tracks a matching drop in cart adds — not a broken cart-to-checkout step.`,
      bad: `Fewer shoppers starting checkout, with steady cart adds, usually means the cart page itself is losing people — check for a missing or broken checkout button, or a bad surprise shown before checkout even starts.`,
    },
  },
  add_shipping_info: {
    what: `Fires when a shopper submits their shipping address during checkout.`,
    trigger: `Completing the shipping-address step of checkout.`,
    up: {
      good: `More shoppers reaching this step means the first checkout hurdle — starting checkout at all — is working well.`,
      bad: `A spike here with a drop-off right after usually means the form itself is fine, but what's revealed next (shipping cost, delivery time) is the problem.`,
    },
    down: {
      good: `Only reassuring if begin_checkout dropped by a similar amount.`,
      bad: `Fewer shoppers reaching this step than started checkout usually points to a broken or confusing shipping form — too many required fields, no address autocomplete, or a validation error.`,
    },
  },
  add_payment_info: {
    what: `Fires when a shopper submits payment details during checkout, before the order is placed.`,
    trigger: `Completing the payment step of checkout.`,
    up: {
      good: `More shoppers reaching payment means the checkout funnel up to this point is working — the order is nearly won.`,
      bad: `A spike here without a matching rise in purchases usually means the very last step is where things break — a payment-processor error, an unsupported card type, or a 3-D Secure hiccup.`,
    },
    down: {
      good: `Only reassuring if it tracks a proportional drop in shoppers reaching the shipping step.`,
      bad: `Fewer shoppers reaching payment than reached shipping usually means the shipping-cost reveal or delivery estimate is scaring people off before they'll enter a card.`,
    },
  },
  purchase: {
    what: `Fires once per completed order, right after checkout finishes and payment is confirmed.`,
    trigger: `A customer finishes checkout and their payment succeeds.`,
    up: {
      good: `The clearest sign of business growth — more completed orders is directly more revenue.`,
      bad: `A spike disconnected from traffic growth is worth a sanity check: test or duplicate orders, a coupon glitch letting the same order through twice, or a reseller/bot buying up limited stock can all inflate this without real organic demand.`,
    },
    down: {
      good: `Fewer orders can simply reflect a genuinely slower period (season, day of week) — check whether traffic dropped by a similar amount before reading too much into it.`,
      bad: `Fewer completed orders directly means less revenue — check for a traffic drop, a broken checkout step, a payment-processor outage, or a pricing/inventory problem.`,
    },
  },
  refund: {
    what: `Fires when an order, or part of one, is refunded.`,
    trigger: `A refund is issued in the store's order-management or payment system.`,
    up: {
      good: `Almost never a good sign — in rare cases a rise reflects a business voluntarily expanding its return policy to build trust, but that's the exception.`,
      bad: `Rising refunds means money is coming back out the door — usually a sign of product-quality issues, inaccurate listings, shipping damage, or buyer's remorse from an over-promising ad or description.`,
    },
    down: {
      good: `Fewer refunds means orders are sticking — what's shipped is matching what was promised.`,
      bad: `Almost never a bad sign on its own.`,
    },
  },
  sign_up: {
    what: `Fires when a visitor creates an account.`,
    trigger: `Completing the account-registration form — not the same as a purchase, since a shopper can often buy as a guest.`,
    up: {
      good: `More sign-ups builds a bigger owned audience for email/SMS marketing and repeat-purchase campaigns — valuable even before any of them buy.`,
      bad: `A spike from a fake-account bot wave, or from a "forced account creation" step that's blocking guest checkout, can inflate this while actually hurting conversion.`,
    },
    down: {
      good: `Fine if guest checkout is doing its job — fewer accounts isn't a problem as long as purchases aren't suffering.`,
      bad: `Fewer sign-ups shrinks the pool of shoppers you can remarket to directly.`,
    },
  },
  login: {
    what: `Fires when a returning visitor signs into their existing account.`,
    trigger: `Submitting the login form successfully.`,
    up: {
      good: `More logins usually means more returning customers are coming back — a healthy loyalty signal.`,
      bad: `Rarely bad — a spike from repeated failed-then-successful attempts could hint at a confusing login form, but that's an edge case.`,
    },
    down: {
      good: `Rarely good on its own.`,
      bad: `Fewer logins can mean returning customers aren't coming back — check win-back email/remarketing, and whether the login flow itself broke.`,
    },
  },
  search: {
    what: `Fires when a shopper uses the on-site search bar.`,
    trigger: `Submitting a query in site search.`,
    up: {
      good: `More searches can mean more engaged shoppers actively hunting for something specific — often a higher-intent group than average browsers.`,
      bad: `A rise can also mean shoppers can't find what they want through normal navigation or category browsing, and are falling back to search out of frustration.`,
    },
    down: {
      good: `Can mean navigation and category pages are doing their job well enough that search isn't needed.`,
      bad: `Rarely bad on its own — mainly worth a look if it comes with falling product views too.`,
    },
  },
  add_to_wishlist: {
    what: `Fires when a shopper saves a product for later instead of buying now.`,
    trigger: `Clicking a save, wishlist, or heart icon on a product.`,
    up: {
      good: `More wishlist saves means more future purchase intent banked for later — a good remarketing and back-in-stock-alert audience.`,
      bad: `Can also mean shoppers are parking items instead of buying now, often due to price hesitation — worth pairing with a wishlist-reminder or price-drop campaign.`,
    },
    down: {
      good: `Can be fine if it tracks a shift toward shoppers buying immediately instead of saving for later.`,
      bad: `Fewer saves shrinks the audience available for "still interested?" remarketing.`,
    },
  },
};

// ---- core GA4 traffic / engagement / revenue metrics ----
const METRICS: Record<string, Knowledge> = {
  sessions: {
    what: `Counts individual visits to the site — a burst of activity from one visitor, ending after 30 minutes of inactivity (or at midnight, by default).`,
    trigger: `A visitor arrives and starts interacting with the site.`,
    up: {
      good: `More visits means more people discovering the store — more opportunities to sell.`,
      bad: `A spike from a single low-quality source (a bot crawl, a bought traffic package, an ad targeting the wrong audience) inflates this without adding real buyers — check engagement rate and conversion rate alongside it.`,
    },
    down: {
      good: `Rarely good on its own — occasionally reflects intentionally pausing a low-quality ad channel.`,
      bad: `Fewer visits directly shrinks the pool of potential buyers — check ad spend, SEO rankings, and referral sources.`,
    },
  },
  totalUsers: {
    what: `Counts distinct people (by device/browser) who visited in the period.`,
    trigger: `A visitor's first tracked activity in the period.`,
    up: {
      good: `More visitors means wider reach — more distinct people exposed to the store.`,
      bad: `A spike concentrated in one-and-done visitors, with no repeat and no engagement, can mean reach without real audience quality.`,
    },
    down: {
      good: `Rarely good on its own.`,
      bad: `Fewer visitors means shrinking reach — check acquisition channels for a drop-off.`,
    },
  },
  newUsers: {
    what: `Counts visitors triggering their first-ever session on this site (by device/browser).`,
    trigger: `A visitor's first visit, as GA4 determines it from device and browser signals.`,
    up: {
      good: `More first-time visitors means marketing and acquisition channels are successfully reaching new people.`,
      bad: `A spike with flat total visitors, or a falling returning-visitor share, can mean paid acquisition is running hot while the loyal base is being neglected.`,
    },
    down: {
      good: `Can be fine if it comes with returning visitors holding steady or growing — the store may be leaning more on retention than acquisition right now.`,
      bad: `Fewer first-time visitors usually means top-of-funnel acquisition — ads, SEO, social — has slowed.`,
    },
  },
  activeUsers: {
    what: `GA4's standard user count — visitors who logged at least one engaged session in the period.`,
    trigger: `A visitor's session meets GA4's engagement bar: 10+ seconds, a conversion event, or 2+ pageviews.`,
    up: {
      good: `More engaged visitors — traffic isn't just arriving, it's sticking around.`,
      bad: `Rarely bad — mainly worth checking it's paired with a real total-visitor increase, not just a tracking change.`,
    },
    down: {
      good: `Rarely good on its own.`,
      bad: `Fewer engaged visitors, even if raw traffic held steady, means quality dropped — check what changed in the visitor mix.`,
    },
  },
  screenPageViews: {
    what: `Counts every page or screen load, including a visitor viewing the same page more than once.`,
    trigger: `A page finishes loading, or a virtual pageview fires on a route change.`,
    up: {
      good: `More page views usually tracks with more browsing — a sign of an engaged, exploring audience.`,
      bad: `A spike disconnected from session growth can mean visitors are stuck reloading a page (a broken redirect, a slow checkout step), or a tracking double-fire.`,
    },
    down: {
      good: `Can be fine if it comes with visitors reaching what they want in fewer clicks — a more efficient site.`,
      bad: `Fewer page views alongside falling sessions usually just tracks less traffic overall.`,
    },
  },
  purchaseRevenue: {
    what: `Total revenue from completed purchases, before any refunds are subtracted.`,
    trigger: `Sums the order value of every purchase event in the period.`,
    up: {
      good: `More revenue is the most direct measure of the store doing well.`,
      bad: `A spike from a handful of unusually large orders, or a pricing error letting items through overpriced, can make the top line look better than the underlying trend actually is.`,
    },
    down: {
      good: `Rarely good on its own.`,
      bad: `Less revenue — check whether it's driven by fewer orders, smaller orders, or a mix-shift toward lower-priced products.`,
    },
  },
  totalRevenue: {
    what: `All tracked revenue, including purchases and any other revenue events configured on this property.`,
    trigger: `Sums every revenue-tagged event in the period.`,
    up: {
      good: `More total revenue is a direct sign of business growth.`,
      bad: `Same caveat as purchase revenue — verify it's broad-based growth, not a handful of outlier orders.`,
    },
    down: {
      good: `Rarely good on its own.`,
      bad: `Less revenue overall — worth breaking down by source to see what specifically fell.`,
    },
  },
  averagePurchaseRevenue: {
    what: `Average order value — total purchase revenue divided by number of orders.`,
    trigger: `Recalculated from every order's value in the period.`,
    up: {
      good: `Shoppers are buying more per order — upsells, bundles, or a shift to higher-value products are working.`,
      bad: `Can also mean a few larger customers are propping up the average while regular order volume shrinks — check order count alongside it.`,
    },
    down: {
      good: `Can be fine, even good, if it comes with a rise in order count — more customers buying smaller, more frequent orders instead of a few big ones.`,
      bad: `Smaller average orders can mean deeper discounting, a shift toward cheaper products, or weaker upsell/cross-sell.`,
    },
  },
  averageRevenuePerUser: {
    what: `Total revenue divided by total users — how much the average visitor was worth.`,
    trigger: `Recalculated from revenue and visitor counts in the period.`,
    up: {
      good: `Each visitor is worth more on average — better monetization of the same traffic.`,
      bad: `Can rise simply because low-value traffic dried up (fewer visitors, similar revenue) rather than existing visitors actually spending more — check total users alongside it.`,
    },
    down: {
      good: `Can be fine if it comes with strong growth in total visitors — diluted by scale, not by weaker buyers.`,
      bad: `Each visitor is worth less on average — check conversion rate and average order value for the underlying cause.`,
    },
  },
  engagementRate: {
    what: `The share of sessions that counted as "engaged" — lasted 10+ seconds, included a conversion, or had 2+ pageviews.`,
    trigger: `Calculated per session against GA4's engagement bar.`,
    up: {
      good: `More of the traffic arriving is actually interested — usually a sign of better-matched ads, content, or landing pages.`,
      bad: `Rarely bad — worth a look mainly if it rises while total sessions are falling, since that trade-off (fewer but more selective visits) may or may not be intentional.`,
    },
    down: {
      good: `Rarely good on its own.`,
      bad: `A falling engagement rate usually means new traffic doesn't match what the ads or content promised — the classic sign of an underperforming ad campaign or a landing-page mismatch.`,
    },
  },
  engagedSessions: {
    what: `The raw count of sessions that met GA4's engagement bar.`,
    trigger: `Same bar as engagement rate, counted rather than expressed as a share.`,
    up: {
      good: `More genuinely engaged visits — more real, interested traffic.`,
      bad: `Rarely bad — check it isn't just tracking overall session growth without the underlying rate actually improving.`,
    },
    down: {
      good: `Rarely good on its own.`,
      bad: `Fewer engaged visits — check both traffic volume and engagement rate to see which one is driving it.`,
    },
  },
  averageSessionDuration: {
    what: `The average length of a session, in seconds.`,
    trigger: `Time between a session's first and last recorded event.`,
    up: {
      good: `Visits are lasting longer — usually a sign of stronger interest or more content/products being explored.`,
      bad: `Can also mean visitors are stuck — a slow-loading page, a confusing checkout, or a broken flow keeping them on-site without progressing.`,
    },
    down: {
      good: `Can be a good sign if it comes with steady or rising conversions — visitors finding what they want faster.`,
      bad: `Shorter visits can mean less interest, or content and products that aren't landing.`,
    },
  },
  bounceRate: {
    what: `The share of sessions that were NOT engaged — left without 10+ seconds, a conversion, or a second pageview.`,
    trigger: `The inverse of engagement rate, calculated per session.`,
    up: {
      good: `Very rarely a good sign.`,
      bad: `More visitors are leaving immediately — usually a mismatch between what an ad or link promised and what the landing page delivers, or a slow-loading page.`,
    },
    down: {
      good: `Fewer immediate exits means more of the traffic is sticking around and exploring.`,
      bad: `Rarely a bad sign on its own.`,
    },
  },
  conversions: {
    what: `Count of key events — the actions marked as conversions in this property.`,
    trigger: `Any event flagged as a key event fires.`,
    up: {
      good: `More completed goals — the site is doing more of whatever the business cares about most.`,
      bad: `A spike disconnected from traffic can mean a tracking duplication bug rather than real growth — check whether one specific key event is driving the whole increase.`,
    },
    down: {
      good: `Rarely good on its own.`,
      bad: `Fewer completed goals — check which specific key event dropped to find the real cause.`,
    },
  },
  keyEvents: {
    what: `Count of key events — GA4's current name for conversions, the actions marked as goals in this property.`,
    trigger: `Any event flagged as a key event fires.`,
    up: {
      good: `More completed goals — the site is doing more of whatever the business cares about most.`,
      bad: `A spike disconnected from traffic can mean a tracking duplication bug rather than real growth — check whether one specific key event is driving the whole increase.`,
    },
    down: {
      good: `Rarely good on its own.`,
      bad: `Fewer completed goals — check which specific key event dropped to find the real cause.`,
    },
  },
};

/** Fallback for an event this app doesn't have dedicated copy for — still
 *  gives both readings of the observed direction, using the same
 *  bad-when-up name pattern metricIsInverted itself relies on. */
function genericEventKnowledge(eventName: string): Knowledge {
  const label = humanizeEvent(eventName).toLowerCase();
  if (isNegativeEventName(eventName)) {
    return {
      what: `A custom event fired whenever "${label}" happens on the site.`,
      trigger: `Whatever this property's tracking defines as a "${label}" action.`,
      up: {
        good: `Very rarely a good sign for an event named like this.`,
        bad: `More of these usually signals a problem — the event's own name ("${label}") suggests something going wrong for shoppers.`,
      },
      down: {
        good: `Fewer of these is usually a good sign — less of whatever this event flags as going wrong.`,
        bad: `Rarely a bad sign on its own.`,
      },
    };
  }
  return {
    what: `A custom event fired whenever "${label}" happens on the site.`,
    trigger: `Whatever this property's tracking defines as a "${label}" action.`,
    up: {
      good: `More of these usually means more shoppers taking this action — generally a positive engagement signal.`,
      bad: `Worth checking this isn't a tracking duplication rather than real growth, especially if it moved a lot more than traffic did.`,
    },
    down: {
      good: `Can be fine if it tracks a proportional drop in overall traffic.`,
      bad: `Fewer shoppers taking this action — worth a look if traffic didn't fall by a similar amount.`,
    },
  };
}

/** Fallback for a real GA4 metric this app doesn't have dedicated copy for. */
function genericMetricKnowledge(apiName: string): Knowledge {
  const label = humanize(apiName).toLowerCase();
  return {
    what: `A GA4 metric: ${label}.`,
    trigger: `Recalculated from the underlying data for this metric over the selected date range.`,
    up: {
      good: `An increase in ${label} generally points to growth or a healthier store.`,
      bad: `Worth a sanity check that this rise reflects a broad trend rather than one outlier day or row.`,
    },
    down: {
      good: `Can be fine if it tracks an intentional or expected change elsewhere in the funnel.`,
      bad: `A decrease in ${label} is generally worth investigating.`,
    },
  };
}

/** Conversion-rate metrics (convu:*, convs:*) reframe the underlying event's
 *  knowledge as a rate — "share of visitors/visits", not a raw count — since
 *  a rate moving is a different (and often more meaningful) story than the
 *  count moving: it separates "the funnel got better/worse" from "traffic
 *  got bigger/smaller". */
function conversionRateKnowledge(apiName: string): Knowledge {
  const eventName = convRateEventName(apiName);
  const denom = convRateDenom(apiName);
  const denomLabel = denom === "totalUsers" ? "visitors" : "visits";
  const base = EVENTS[eventName] ?? genericEventKnowledge(eventName);
  const evLabel = humanizeEvent(eventName).toLowerCase();
  return {
    what: `A conversion rate: the share of ${denomLabel} in the period whose session included a "${evLabel}" event — not a raw count.`,
    trigger: base.trigger,
    up: {
      good: `A rising share means the store is converting ${denomLabel} into "${evLabel}" more efficiently — not just riding a traffic increase.`,
      bad: base.up.bad,
    },
    down: {
      good: base.down.good,
      bad: `A falling share means the store is converting ${denomLabel} into "${evLabel}" less efficiently — worth investigating even if the raw count held steady.`,
    },
  };
}

function knowledgeFor(apiName: string): Knowledge {
  if (isConvRateMetric(apiName)) return conversionRateKnowledge(apiName);
  if (isEventMetric(apiName)) {
    const eventName = eventMetricName(apiName);
    return EVENTS[eventName] ?? genericEventKnowledge(eventName);
  }
  return METRICS[apiName] ?? genericMetricKnowledge(apiName);
}

// A previous-period value this small makes any percentage off it noise —
// the same "trivial base" bar insightEngine's own rules guard against
// (MIN_PREV_BASE there). A jump like 8 -> 319 (+3887.5%) reads as explosive
// organic growth when it's really "this barely existed before."
const NOISY_BASE_THRESHOLD = 30;

/** Full hover-tooltip content for a delta badge: what the metric/event is,
 *  what specifically triggers it, why THIS observed direction (up or down)
 *  reads as good or bad — matching the badge's own color — and the honest
 *  flip side of that same direction, so a real "it depends" case doesn't get
 *  flattened into a single verdict. `prevValue`, when given, lets a huge
 *  swing off a near-zero base get flagged as noise instead of a real trend. */
export function explainDelta(apiName: string, value: number, prevValue?: number): DeltaExplanation {
  const kb = knowledgeFor(apiName);
  if (value === 0) {
    return {
      what: kb.what,
      trigger: kb.trigger,
      primary: `No change vs the comparison period.`,
      caveat: `Nothing to read into a flat period on its own — worth another look once there's a real move either way.`,
    };
  }
  const up = value > 0;
  const inverted = metricIsInverted(apiName);
  const good = inverted ? value < 0 : value > 0;
  const dir = up ? kb.up : kb.down;
  const noisyBase = up && prevValue !== undefined && prevValue > 0 && prevValue < NOISY_BASE_THRESHOLD;
  return {
    what: kb.what,
    trigger: kb.trigger,
    primary: good ? dir.good : dir.bad,
    caveat: noisyBase
      ? `The comparison period had only ${Math.round(prevValue)} — a number that small means this may be a new or recently-changed element rather than organic growth. Treat the percentage itself as noise.`
      : good
        ? dir.bad
        : dir.good,
  };
}

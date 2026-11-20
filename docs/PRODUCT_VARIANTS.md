# Product variants

A listing may have zero or more seller-defined variants. Existing listings with no variants keep their current behaviour and public response shape.

## Data model

`ListingVariant` belongs to one `Listing` and stores:
- a buyer-facing label;
- flexible option key/value data (for example, `Colour=Black` and `Storage=256 GB`);
- an optional SKU;
- an optional price override (null inherits the parent listing price);
- optional seller-reported stock tracking and availability;
- optional variant-specific photo URLs.

The additive PostgreSQL migration is `20261121090000_product_variants`. It adds nullable variant references and a JSON snapshot to `Enquiry`. When a variant is removed, the foreign key is cleared but the historical snapshot remains.

## Merchant API

The owner of an active OFFER replaces the variant set with:

`PUT /api/listings/{listingId}/variants`

Body shape:

```json
{
  "variants": [
    {
      "label": "Black · 256 GB",
      "options": { "Colour": "Black", "Storage": "256 GB" },
      "sku": "PHONE-BLK-256",
      "price": 1250000,
      "trackInventory": true,
      "stockQuantity": 3,
      "availabilityStatus": "IN_STOCK",
      "photos": []
    }
  ]
}
```

The API enforces seller ownership, active OFFER status, unique option combinations, unique non-empty SKUs, and a quantity whenever tracking is enabled. Inventory tracking is optional.

## Buyer behaviour

The in-app listing detail lets the buyer choose an option. The selected option drives the displayed price, availability and gallery. The selected variant ID is submitted with an in-app enquiry; the server validates that it belongs to the requested listing and stores a snapshot of its effective price, currency, unit, options, SKU and stock context.

Variant listings intentionally do not use the existing basket action yet. Basket lines are keyed only by listing ID, so adding distinct variants would incorrectly merge them. The buyer can message the seller with the exact selected option instead.

## Explicit limitations

This first increment does not create orders, reserve or decrement stock, or connect variant stock to the existing BusinessProduct / SaleItem / StockMovement ledger. The canonical server-rendered `/l/{id}` share page lists the available options and sends buyers into the in-app detail for interactive selection. No production migration or deployment is part of this change.

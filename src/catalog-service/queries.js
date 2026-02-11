/**
 * GraphQL query strings for the Adobe Commerce Catalog Service API.
 */

/**
 * Search all products with pagination.
 * Using phrase=" " as a wildcard to return all products.
 *
 * Variables: { pageSize: Int, currentPage: Int }
 */
export const PRODUCT_SEARCH_QUERY = `
  query ListProducts($pageSize: Int!, $currentPage: Int!) {
    productSearch(phrase: " ", page_size: $pageSize, current_page: $currentPage) {
      items {
        productView {
          sku
          name
          urlKey
          __typename
        }
      }
      page_info {
        current_page
        page_size
        total_pages
      }
      total_count
    }
  }
`;

/**
 * Fetch full product details for a batch of SKUs.
 * Handles both SimpleProductView (direct price) and ComplexProductView (options + priceRange).
 *
 * Variables: { skus: [String!]! }
 */
export const PRODUCTS_QUERY = `
  query FetchProducts($skus: [String!]!) {
    products(skus: $skus) {
      __typename
      id
      sku
      name
      urlKey
      description
      shortDescription
      metaTitle
      metaDescription
      metaKeyword
      inStock
      addToCartAllowed
      url
      externalId
      images(roles: []) {
        url
        label
        roles
      }
      attributes(roles: []) {
        name
        label
        value
        roles
      }
      ... on SimpleProductView {
        price {
          roles
          regular {
            amount {
              value
              currency
            }
          }
          final {
            amount {
              value
              currency
            }
          }
        }
      }
      ... on ComplexProductView {
        options {
          id
          title
          required
          multi
          values {
            id
            title
            inStock
            __typename
            ... on ProductViewOptionValueSwatch {
              id
              title
              type
              value
              inStock
            }
            ... on ProductViewOptionValueProduct {
              title
              quantity
              isDefault
              product {
                sku
                name
                price {
                  final {
                    amount {
                      value
                      currency
                    }
                  }
                  regular {
                    amount {
                      value
                      currency
                    }
                  }
                }
              }
            }
          }
        }
        priceRange {
          minimum {
            final {
              amount {
                value
                currency
              }
            }
            regular {
              amount {
                value
                currency
              }
            }
            roles
          }
          maximum {
            final {
              amount {
                value
                currency
              }
            }
            regular {
              amount {
                value
                currency
              }
            }
            roles
          }
        }
      }
    }
  }
`;

/**
 * Fetch variants for a complex product.
 * The `selections` field contains UIDs that map to option values from the product query.
 *
 * Variables: { sku: String! }
 */
export const VARIANTS_QUERY = `
  query FetchVariants($sku: String!) {
    variants(sku: $sku) {
      variants {
        selections
        product {
          sku
          name
          inStock
          images(roles: []) {
            url
            label
            roles
          }
          ... on SimpleProductView {
            price {
              final {
                amount {
                  value
                  currency
                }
              }
              regular {
                amount {
                  value
                  currency
                }
              }
            }
          }
        }
      }
    }
  }
`;

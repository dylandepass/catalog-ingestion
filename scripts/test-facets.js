const query = `{
  productSearch(phrase: " ", page_size: 1, current_page: 1) {
    facets {
      title
      attribute
      type
      buckets {
        title
        __typename
        ... on CategoryView {
          name
          level
          urlKey
          urlPath
          parentId
          children { name urlKey urlPath level }
        }
        ... on ScalarBucket { id count }
        ... on RangeBucket { from to count }
        ... on StatsBucket { min max }
      }
    }
  }
}`;

const res = await fetch('https://edge-graph.adobe.io/api/b8226c70-6dad-4c85-a17b-9b0a3fc3abe2/graphql', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'magento-environment-id': 'VyumfC53bDYkVB6b8MXsJh',
    'magento-store-code': 'main_website_store',
    'magento-store-view-code': 'default',
    'magento-website-code': 'base',
    'magento-customer-group': 'b6589fc6ab0dc82cf12099d1c2d40ab994e8410c',
    'x-api-key': 'not_used',
  },
  body: JSON.stringify({ query }),
});

const data = await res.json();
const facets = data.data?.productSearch?.facets || [];

for (const f of facets) {
  console.log(`\n=== ${f.title} (${f.attribute}, type=${f.type}) ===`);
  for (const b of (f.buckets || []).slice(0, 20)) {
    if (b.__typename === 'CategoryView') {
      const kids = (b.children || []).map(c => c.name).join(', ');
      console.log(`  [CAT] ${b.name} (level=${b.level}, urlPath=${b.urlPath}, parent=${b.parentId})`);
      if (kids) console.log(`        children: ${kids}`);
    } else if (b.__typename === 'ScalarBucket') {
      console.log(`  [SCALAR] ${b.title} (id=${b.id}, count=${b.count})`);
    } else if (b.__typename === 'RangeBucket') {
      console.log(`  [RANGE] ${b.from}-${b.to} (count=${b.count})`);
    } else if (b.__typename === 'StatsBucket') {
      console.log(`  [STATS] ${b.min}-${b.max}`);
    }
  }
}

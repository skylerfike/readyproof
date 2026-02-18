// test-pricing.js — Test the pricing calculator
const pricing = require('./pricing');

async function test() {
  console.log('Testing pricing calculator...\n');

  // Test 1: Fetch packages
  console.log('1. Fetching packages from Google Sheets...');
  const packages = await pricing.getPackages();
  console.log(`   ✓ Found ${packages.length} packages`);
  console.log(`   Example: ${packages[0].name} - ${packages[0].images_included} images included\n`);

  // Test 2: Fetch add-ons
  console.log('2. Fetching add-ons from Google Sheets...');
  const addons = await pricing.getAddons();
  console.log(`   ✓ Found ${addons.length} add-ons`);
  console.log(`   Example: ${addons[0].name} - $${addons[0].price}\n`);

  // Test 3: Calculate pricing for ONLO 45
  console.log('3. Testing pricing calculation for ONLO 45...');
  console.log('   Scenario: Client selects 5 images (3 extra), 2 with Tier I upgrade');
  
  const selectedImages = [
    { filename: 'img1.jpg', editing_tier: 'basic' },     // included, basic
    { filename: 'img2.jpg', editing_tier: 'tier_1' },    // included, upgraded
    { filename: 'img3.jpg', editing_tier: 'basic' },     // extra, basic
    { filename: 'img4.jpg', editing_tier: 'tier_1' },    // extra, upgraded
    { filename: 'img5.jpg', editing_tier: 'basic' },     // extra, basic
  ];

  const breakdown = await pricing.calculatePricing('onlo_45', selectedImages);
  
  console.log('\n   Price Breakdown:');
  breakdown.line_items.forEach(item => {
    console.log(`   - ${item.description}: $${item.total}`);
  });
  console.log(`   ───────────────────────────────`);
  console.log(`   TOTAL: $${breakdown.total}\n`);

  console.log('✓ All tests passed!');
}

test().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});

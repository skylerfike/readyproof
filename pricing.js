// pricing.js — Pricing calculator using Google Sheets data
const fetch = require('node-fetch');

// Google Sheets published CSV URLs
const SHEETS = {
  packages: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSx-twkl_l9aV1NaijXuQvTB2zUD8PHMbxANscShoVPWcmlbun_4KnVBOq6MZf3kToabASL6_9jYzL9/pub?gid=1951061626&single=true&output=csv',
  postSessionAddons: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSx-twkl_l9aV1NaijXuQvTB2zUD8PHMbxANscShoVPWcmlbun_4KnVBOq6MZf3kToabASL6_9jYzL9/pub?gid=671637486&single=true&output=csv',
  preSessionAddons: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSx-twkl_l9aV1NaijXuQvTB2zUD8PHMbxANscShoVPWcmlbun_4KnVBOq6MZf3kToabASL6_9jYzL9/pub?gid=259397384&single=true&output=csv',
};

// Cache with 1 hour TTL
let cache = {
  packages: { data: null, expires: 0 },
  addons: { data: null, expires: 0 },
};

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Parse CSV to array of objects
function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = values[i] || '';
    });
    return obj;
  });
}

// Fetch and cache packages
async function getPackages() {
  const now = Date.now();
  if (cache.packages.data && cache.packages.expires > now) {
    return cache.packages.data;
  }

  try {
    const res = await fetch(SHEETS.packages);
    const csv = await res.text();
    const packages = parseCSV(csv);
    
    // Convert numeric fields
    packages.forEach(p => {
      p.images_included = parseInt(p.images_included) || 0;
      p.session_price = parseFloat(p.session_price) || 0;
    });

    cache.packages = { data: packages, expires: now + CACHE_TTL };
    return packages;
  } catch (err) {
    console.error('Failed to fetch packages:', err.message);
    return cache.packages.data || [];
  }
}

// Fetch and cache add-ons
async function getAddons() {
  const now = Date.now();
  if (cache.addons.data && cache.addons.expires > now) {
    return cache.addons.data;
  }

  try {
    const res = await fetch(SHEETS.postSessionAddons);
    const csv = await res.text();
    const addons = parseCSV(csv);
    
    // Convert numeric fields
    addons.forEach(a => {
      a.price = parseFloat(a.price) || 0;
    });

    cache.addons = { data: addons, expires: now + CACHE_TTL };
    return addons;
  } catch (err) {
    console.error('Failed to fetch add-ons:', err.message);
    return cache.addons.data || [];
  }
}

// Find package by ID
async function getPackageById(packageId) {
  const packages = await getPackages();
  return packages.find(p => p.package_id === packageId);
}

// Calculate pricing for a session
async function calculatePricing(packageId, selectedImages) {
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    throw new Error(`Package not found: ${packageId}`);
  }

  const addons = await getAddons();
  const addonMap = {};
  addons.forEach(a => { addonMap[a.addon_id] = a; });

  const imagesIncluded = pkg.images_included;
  const defaultEditing = pkg.default_editing;

  let breakdown = {
    package: {
      name: pkg.name,
      images_included: imagesIncluded,
      default_editing: defaultEditing,
    },
    line_items: [],
    subtotal: 0,
    total: 0,
  };

  // Count extras
  const totalSelected = selectedImages.length;
  const extraImages = Math.max(0, totalSelected - imagesIncluded);

  // Group images by editing tier
  const tierCounts = { basic: 0, tier_1: 0, tier_2: 0, tier_3: 0 };
  const includedUpgrades = { tier_1: 0, tier_2: 0, tier_3: 0 };
  const extraUpgrades = { tier_1: 0, tier_2: 0, tier_3: 0 };

  selectedImages.forEach((img, idx) => {
    const tier = img.editing_tier || 'basic';
    tierCounts[tier]++;

    // First N images are included, rest are extras
    if (idx < imagesIncluded) {
      if (tier !== 'basic' && tier !== defaultEditing) {
        includedUpgrades[tier]++;
      }
    } else {
      if (tier !== 'basic') {
        extraUpgrades[tier]++;
      }
    }
  });

  // Extra images at $35 each (basic editing)
  if (extraImages > 0) {
    const extraBasic = extraImages - (extraUpgrades.tier_1 + extraUpgrades.tier_2 + extraUpgrades.tier_3);
    if (extraBasic > 0) {
      breakdown.line_items.push({
        description: `${extraBasic} additional image${extraBasic !== 1 ? 's' : ''} (Basic Editing)`,
        quantity: extraBasic,
        unit_price: 35,
        total: extraBasic * 35,
      });
      breakdown.subtotal += extraBasic * 35;
    }
  }

  // Editing upgrades on included images
  ['tier_1', 'tier_2', 'tier_3'].forEach(tier => {
    if (includedUpgrades[tier] > 0) {
      const addon = addonMap[`${tier}_upgrade`];
      if (addon) {
        breakdown.line_items.push({
          description: `${includedUpgrades[tier]} ${addon.name}${includedUpgrades[tier] !== 1 ? 's' : ''}`,
          quantity: includedUpgrades[tier],
          unit_price: addon.price,
          total: includedUpgrades[tier] * addon.price,
        });
        breakdown.subtotal += includedUpgrades[tier] * addon.price;
      }
    }
  });

  // Extra images with editing upgrades (base $35 + upgrade price)
  ['tier_1', 'tier_2', 'tier_3'].forEach(tier => {
    if (extraUpgrades[tier] > 0) {
      const addon = addonMap[`${tier}_upgrade`];
      if (addon) {
        const perImageCost = 35 + addon.price;
        breakdown.line_items.push({
          description: `${extraUpgrades[tier]} additional image${extraUpgrades[tier] !== 1 ? 's' : ''} with ${addon.name}`,
          quantity: extraUpgrades[tier],
          unit_price: perImageCost,
          total: extraUpgrades[tier] * perImageCost,
        });
        breakdown.subtotal += extraUpgrades[tier] * perImageCost;
      }
    }
  });

  breakdown.total = breakdown.subtotal;

  return breakdown;
}

// Calculate with rush delivery
async function calculateWithRush(packageId, selectedImages, includeRush) {
  const breakdown = await calculatePricing(packageId, selectedImages);
  
  if (includeRush && selectedImages.length > 0 && selectedImages.length <= 5) {
    const addons = await getAddons();
    const rushAddon = addons.find(a => a.addon_id === 'rush_24hr');
    if (rushAddon) {
      breakdown.line_items.push({
        description: rushAddon.name,
        quantity: 1,
        unit_price: rushAddon.price,
        total: rushAddon.price,
      });
      breakdown.total += rushAddon.price;
    }
  }

  return breakdown;
}

module.exports = {
  getPackages,
  getAddons,
  getPackageById,
  calculatePricing,
  calculateWithRush,
};

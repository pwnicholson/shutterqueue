const https = require("https");

/**
 * Geocoding service using OpenStreetMap Nominatim API
 * https://nominatim.openstreetmap.org/
 * 
 * Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
 * - Must provide valid User-Agent
 * - Rate limit: Max 1 request per second
 * - No API key required for reasonable usage
 */

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "ShutterQueue/0.9.1 (https://github.com/pwnicholson/shutterqueue)";

/**
 * Determine Flickr accuracy level based on OpenStreetMap place type
 * 
 * Flickr accuracy levels:
 * 1 = World level
 * 3 = Country level
 * 6 = Region level (state/province)
 * 7 = City level
 * 11 = Street level
 * 16 = Exact/precise (house number or lat/long input)
 * 
 * OSM place types: country, state, region, province, city, town, village, 
 * municipality, suburb, quarter, neighbourhood, hamlet, postcode, road, etc.
 */
function determineAccuracy(placeType, addressType) {
  if (!placeType && !addressType) return 16; // Direct lat/long input
  
  const type = (placeType || addressType || "").toLowerCase();
  
  // Country level
  if (type === "country") return 3;
  
  // Region/state/province level
  if (["state", "region", "province"].includes(type)) return 6;
  
  // City/town level (includes postal codes)
  if (["city", "town", "village", "municipality", "postcode"].includes(type)) return 11;
  
  // Street/precise level (roads, house numbers, etc.)
  if (["road", "street", "house", "building", "suburb", "quarter", "neighbourhood", "hamlet"].includes(type)) return 16;
  
  // Default to city level for unknown types
  return 11;
}

/**
 * Search for locations using Nominatim geocoding API
 * 
 * @param {string} query - Search query (address, city, postal code, country, or lat/long)
 * @returns {Promise<Array>} Array of location results
 */
async function searchLocation(query) {
  if (!query || typeof query !== "string") {
    throw new Error("Query must be a non-empty string");
  }
  
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Query cannot be empty");
  }
  
  // Build URL with query parameters
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "10");
  
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "GET",
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "application/json"
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Nominatim API returned status ${res.statusCode}: ${data}`));
            return;
          }
          
          try {
            const results = JSON.parse(data);
            
            if (!Array.isArray(results)) {
              reject(new Error("Invalid response format from Nominatim API"));
              return;
            }
            
            // Transform results to our format
            const locations = results.map(result => {
              const lat = parseFloat(result.lat);
              const lon = parseFloat(result.lon);
              
              if (isNaN(lat) || isNaN(lon)) {
                return null;
              }
              
              const accuracy = determineAccuracy(result.type, result.addresstype);
              
              return {
                displayName: result.display_name || trimmed,
                latitude: lat,
                longitude: lon,
                accuracy: accuracy,
                type: result.type || result.addresstype || "unknown",
                // Include address components for debugging/display
                address: result.address || {}
              };
            }).filter(Boolean); // Remove any null entries
            
            resolve(locations);
          } catch (err) {
            reject(new Error(`Failed to parse Nominatim response: ${err.message}`));
          }
        });
      }
    );
    
    req.on("error", (err) => {
      reject(new Error(`Nominatim API request failed: ${err.message}`));
    });
    
    req.end();
  });
}

/**
 * Parse direct lat/long input
 * Accepts formats:
 * - "40.7128, -74.0060"
 * - "40.7128,-74.0060"
 * - "40.7128 -74.0060"
 * - "40.7128N, 74.0060W"
 * 
 * @param {string} input - Potential lat/long string
 * @returns {Object|null} {latitude, longitude} or null if not valid lat/long
 */
function parseLatLong(input) {
  if (!input || typeof input !== "string") return null;
  
  const cleaned = input.trim()
    .replace(/[NSEW]/gi, "") // Remove cardinal directions
    .replace(/[°]/g, ""); // Remove degree symbols
  
  // Try comma-separated
  let parts = cleaned.split(",");
  if (parts.length !== 2) {
    // Try space-separated
    parts = cleaned.split(/\s+/);
  }
  
  if (parts.length !== 2) return null;
  
  const lat = parseFloat(parts[0].trim());
  const lon = parseFloat(parts[1].trim());
  
  // Validate ranges
  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;
  
  return { latitude: lat, longitude: lon };
}

/**
 * Reverse geocode a lat/long to get display name
 * 
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<string>} Display name for the location
 */
async function reverseGeocode(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "json");
  
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "GET",
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "application/json"
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(`${lat}, ${lon}`); // Fallback to coordinates
            return;
          }
          
          try {
            const result = JSON.parse(data);
            resolve(result.display_name || `${lat}, ${lon}`);
          } catch (err) {
            resolve(`${lat}, ${lon}`); // Fallback to coordinates
          }
        });
      }
    );
    
    req.on("error", () => {
      resolve(`${lat}, ${lon}`); // Fallback to coordinates
    });
    
    req.end();
  });
}

module.exports = {
  searchLocation,
  parseLatLong,
  reverseGeocode,
  determineAccuracy
};

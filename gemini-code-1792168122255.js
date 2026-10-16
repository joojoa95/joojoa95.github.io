/**
 * iTunes Search API Service
 * No API key or authentication required.
 */

const BASE_URL = 'https://itunes.apple.com/search';

/**
 * Search the iTunes store.
 * @param {string} term - The search keywords (e.g., "jack johnson").
 * @param {string} media - Media type (e.g., 'music', 'podcast', 'movie', 'all').
 * @param {number} limit - Number of results to return (default is 25, max 200).
 * @returns {Promise<Array>} - Returns an array of matching items.
 */
async function searchItunes(term, media = 'music', limit = 25) {
  try {
    // Construct URL with query parameters
    const url = new URL(BASE_URL);
    url.searchParams.append('term', term);
    url.searchParams.append('media', media);
    url.searchParams.append('limit', limit);

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.results; // Returns array of results from iTunes
  } catch (error) {
    console.error('Error fetching data from iTunes API:', error);
    throw error;
  }
}

module.exports = { searchItunes };
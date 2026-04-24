const fs = require('fs');

async function downloadJSON(url, filename = 'data.json') {
  try {
    // 1. Fetch the data
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // 2. Convert to string
    const jsonString = JSON.stringify(data, null, 2);

    // 3. Write directly to the same directory
    fs.writeFileSync(filename, jsonString);

    console.log(`Success! Saved to ${filename}`);
  } catch (error) {
    console.error('Download failed:', error.message);
  }
}

// Usage
downloadJSON('https://www.ag-grid.com/example-assets/olympic-winners.json');

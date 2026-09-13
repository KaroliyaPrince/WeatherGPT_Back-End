const axios = require('axios');

async function testBigDataCloud(lat, lon) {
  console.log(`\n==================================================`);
  console.log(`TESTING BIGDATACLOUD FREE REVERSE GEOCODE AT (${lat}, ${lon})`);
  console.log(`==================================================`);

  try {
    const res = await axios.get('https://api.bigdatacloud.net/data/reverse-geocode-client', {
      params: { latitude: lat, longitude: lon, localityLanguage: 'en' },
      timeout: 5000
    });

    console.log('City:', res.data?.city);
    console.log('Locality:', res.data?.locality);
    console.log('Principal Subdivision:', res.data?.principalSubdivision);
    console.log('Locality Info Administrative:', JSON.stringify(res.data?.localityInfo?.administrative, null, 2));
    console.log('Locality Info Informative:', JSON.stringify(res.data?.localityInfo?.informative, null, 2));

  } catch (err) {
    console.error('BigDataCloud error:', err.message);
  }
}

async function main() {
  await testBigDataCloud(22.58, 70.76); // Tankara
  await testBigDataCloud(22.51, 70.78); // Mitana
  await testBigDataCloud(22.68, 70.83); // Panchasiya
}

main();

/**
 * Canonical Places Registry
 * Authoritative database of known settlements with canonical coordinates,
 * normalized IDs, place types, and name aliases.
 */

const CANONICAL_PLACES = [
  // Saurashtra & North Gujarat Corridor (Morbi - Rajkot - Jamnagar - Porbandar - Junagadh)
  {
    id: 'morbi',
    name: 'Morbi',
    latitude: 22.8004,
    longitude: 70.8862,
    placeType: 'city',
    aliases: ['morbi', 'morvi', 'morbi city', 'morbi municipality', 'morbi taluka', 'morbi district']
  },
  {
    id: 'sanala',
    name: 'Sanala',
    latitude: 22.7875,
    longitude: 70.8040,
    placeType: 'town',
    aliases: ['sanala', 'shakti sanala', 'sanala town']
  },
  {
    id: 'haripar',
    name: 'Haripar',
    latitude: 22.5885,
    longitude: 70.7410,
    placeType: 'village',
    aliases: ['haripar', 'haripar village']
  },
  {
    id: 'tankara',
    name: 'Tankara',
    latitude: 22.6562,
    longitude: 70.7495,
    placeType: 'town',
    aliases: ['tankara', 'tankara town', 'tankara municipality', 'tankara taluka', 'tankara subdistrict']
  },
  {
    id: 'mitana',
    name: 'Mitana',
    latitude: 22.5200,
    longitude: 70.7600,
    placeType: 'village',
    aliases: ['mitana', 'mitana village']
  },
  {
    id: 'hadana',
    name: 'Hadana',
    latitude: 22.4500,
    longitude: 70.7800,
    placeType: 'village',
    aliases: ['hadana', 'hadala', 'hadana village']
  },
  {
    id: 'rajkot',
    name: 'Rajkot',
    latitude: 22.3053,
    longitude: 70.8028,
    placeType: 'city',
    aliases: ['rajkot', 'rajkot city', 'rajkot district', 'rajkot municipality']
  },
  {
    id: 'wankaner',
    name: 'Wankaner',
    latitude: 22.6120,
    longitude: 70.9438,
    placeType: 'town',
    aliases: ['wankaner', 'wankaner town', 'wankaner taluka', 'wankaner city']
  },
  {
    id: 'chotila',
    name: 'Chotila',
    latitude: 22.4227,
    longitude: 71.1864,
    placeType: 'town',
    aliases: ['chotila', 'chotila town', 'chotila taluka']
  },
  {
    id: 'limbdi',
    name: 'Limbdi',
    latitude: 22.5659,
    longitude: 71.7229,
    placeType: 'town',
    aliases: ['limbdi', 'limdi', 'limbdi town']
  },
  {
    id: 'sayla',
    name: 'Sayla',
    latitude: 22.5402,
    longitude: 71.4422,
    placeType: 'town',
    aliases: ['sayla', 'sayla town']
  },
  {
    id: 'dhrangadhra',
    name: 'Dhrangadhra',
    latitude: 22.9918,
    longitude: 71.4648,
    placeType: 'town',
    aliases: ['dhrangadhra', 'dhrangadhra town']
  },
  {
    id: 'halvad',
    name: 'Halvad',
    latitude: 22.9691,
    longitude: 71.1764,
    placeType: 'town',
    aliases: ['halvad', 'halvad town']
  },
  {
    id: 'surendranagar',
    name: 'Surendranagar',
    latitude: 22.7234,
    longitude: 71.6366,
    placeType: 'city',
    aliases: ['surendranagar', 'wadhwan', 'surendranagar dudhrej']
  },
  {
    id: 'wadhwan',
    name: 'Wadhwan',
    latitude: 22.6989,
    longitude: 71.6738,
    placeType: 'town',
    aliases: ['wadhwan', 'wadhwan town']
  },

  // Central Gujarat & Highway Corridor (Ahmedabad - Vadodara - Surat - Vapi - Mumbai)
  {
    id: 'bavla',
    name: 'Bavla',
    latitude: 22.6160,
    longitude: 72.1507,
    placeType: 'town',
    aliases: ['bavla', 'bavla town', 'bavla taluka']
  },
  {
    id: 'chuda',
    name: 'Chuda',
    latitude: 22.5456,
    longitude: 71.5788,
    placeType: 'town',
    aliases: ['chuda', 'chuda town']
  },
  {
    id: 'bagodra',
    name: 'Bagodra',
    latitude: 22.5745,
    longitude: 72.0138,
    placeType: 'village',
    aliases: ['bagodra', 'bagodara']
  },
  {
    id: 'tarapur',
    name: 'Tarapur',
    latitude: 22.4953,
    longitude: 72.6417,
    placeType: 'town',
    aliases: ['tarapur', 'tarapur town']
  },
  {
    id: 'borsad',
    name: 'Borsad',
    latitude: 22.4111,
    longitude: 72.9006,
    placeType: 'town',
    aliases: ['borsad', 'borsad town']
  },
  {
    id: 'petlad',
    name: 'Petlad',
    latitude: 22.4268,
    longitude: 72.7664,
    placeType: 'town',
    aliases: ['petlad', 'petlad town']
  },
  {
    id: 'anklav',
    name: 'Anklav',
    latitude: 22.3833,
    longitude: 73.0000,
    placeType: 'town',
    aliases: ['anklav', 'anklav town']
  },
  {
    id: 'padra',
    name: 'Padra',
    latitude: 22.2378,
    longitude: 73.0847,
    placeType: 'town',
    aliases: ['padra', 'padra town']
  },
  {
    id: 'ahmedabad',
    name: 'Ahmedabad',
    latitude: 23.0225,
    longitude: 72.5714,
    placeType: 'city',
    aliases: ['ahmedabad', 'amdavad', 'ahmedabad city']
  },
  {
    id: 'sanand',
    name: 'Sanand',
    latitude: 22.9902,
    longitude: 72.3800,
    placeType: 'town',
    aliases: ['sanand', 'sanand town']
  },
  {
    id: 'nadiad',
    name: 'Nadiad',
    latitude: 22.6916,
    longitude: 72.8634,
    placeType: 'city',
    aliases: ['nadiad', 'nadiad city']
  },
  {
    id: 'anand',
    name: 'Anand',
    latitude: 22.5645,
    longitude: 72.9289,
    placeType: 'city',
    aliases: ['anand', 'anand city']
  },
  {
    id: 'vadodara',
    name: 'Vadodara',
    latitude: 22.3072,
    longitude: 73.1812,
    placeType: 'city',
    aliases: ['vadodara', 'baroda', 'vadodara city', 'vadodara rural']
  },
  {
    id: 'bharuch',
    name: 'Bharuch',
    latitude: 21.7051,
    longitude: 72.9959,
    placeType: 'city',
    aliases: ['bharuch', 'broach', 'bharuch city']
  },
  {
    id: 'ankleshwar',
    name: 'Ankleshwar',
    latitude: 21.6208,
    longitude: 72.9382,
    placeType: 'city',
    aliases: ['ankleshwar', 'anklesvar']
  },
  {
    id: 'surat',
    name: 'Surat',
    latitude: 21.1702,
    longitude: 72.8311,
    placeType: 'city',
    aliases: ['surat', 'surat city']
  },
  {
    id: 'mangrol',
    name: 'Mangrol',
    latitude: 21.3860,
    longitude: 72.9896,
    placeType: 'town',
    aliases: ['mangrol', 'mangrol town']
  },
  {
    id: 'palsana',
    name: 'Palsana',
    latitude: 21.1190,
    longitude: 73.0381,
    placeType: 'town',
    aliases: ['palsana', 'palsana town']
  },
  {
    id: 'navsari',
    name: 'Navsari',
    latitude: 20.9467,
    longitude: 72.9520,
    placeType: 'city',
    aliases: ['navsari', 'navsari city']
  },
  {
    id: 'gandevi',
    name: 'Gandevi',
    latitude: 20.8722,
    longitude: 73.0744,
    placeType: 'town',
    aliases: ['gandevi', 'gandevi town']
  },
  {
    id: 'chikhli',
    name: 'Chikhli',
    latitude: 20.7423,
    longitude: 73.0376,
    placeType: 'town',
    aliases: ['chikhli', 'chikhli town']
  },
  {
    id: 'valsad',
    name: 'Valsad',
    latitude: 20.5992,
    longitude: 72.9342,
    placeType: 'city',
    aliases: ['valsad', 'bulsar']
  },
  {
    id: 'pardi',
    name: 'Pardi',
    latitude: 20.4235,
    longitude: 72.9180,
    placeType: 'town',
    aliases: ['pardi', 'pardi town']
  },
  {
    id: 'vapi',
    name: 'Vapi',
    latitude: 20.3893,
    longitude: 72.9106,
    placeType: 'city',
    aliases: ['vapi', 'vapi city']
  },
  {
    id: 'dahanu',
    name: 'Dahanu',
    latitude: 20.0280,
    longitude: 72.9232,
    placeType: 'town',
    aliases: ['dahanu', 'dahanu town']
  },
  {
    id: 'palghar',
    name: 'Palghar',
    latitude: 19.6966,
    longitude: 72.7654,
    placeType: 'town',
    aliases: ['palghar', 'palghar town']
  },
  {
    id: 'vasai',
    name: 'Vasai',
    latitude: 19.3919,
    longitude: 72.8397,
    placeType: 'city',
    aliases: ['vasai', 'vasai-virar', 'virar']
  },
  {
    id: 'mumbai',
    name: 'Mumbai',
    latitude: 19.0760,
    longitude: 72.8777,
    placeType: 'city',
    aliases: ['mumbai', 'bombay', 'mumbai city']
  },
  {
    id: 'delhi',
    name: 'Delhi',
    latitude: 28.6139,
    longitude: 77.2090,
    placeType: 'city',
    aliases: ['delhi', 'new delhi']
  }
];

module.exports = {
  CANONICAL_PLACES
};

const fs = require('fs');
const path = require('path');

const MASTER_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));

const inkindList = `Clinton Hall FiDi
Botte Brooklyn
El Cedro
Casa Thirteen
Vallarta Tropical
The Butcher's Daughter
Macao Trading Company
Little Rascal - Nolita
Ketchy Shuby
Pasquale Jones
Kalye - Rivington
Stafili Wine Cafe
Treadwell Park - NYC Downtown
Black Hound Bar
Mezze on the River
American Cut Steakhouse
The Skinny Bar & Lounge
Boni & Mott
Sami & Susu
Fossetta
Yves
Momoya - SoHo
Musket Room
Tacombi - NoLita
Divya's Kitchen
Black Tap Craft Burgers
Tender Crush
Lele's Roman
Koju
Raf's
KYU NYC
Aquarelle
Psaraki
Two Hands - NoHo
Bar Rêve
Ella Funt
Mishik
ATLA - NoHo, NY
Adoro Lei
Sarabeth's - Greenwich
Malai Marke
Pardon My French
Tacombi - Fort Greene
Duo Cafe
Rocco's Sports & Recreation
Avant Garden
Madam Ji Ki Shaadi
Charlie Bird
Cadence
Ladybird
Jean's
Little Hen - NYC
Margot Brooklyn
Nudibranch
Old Tbilisi Garden
Port Sa'id
Public Records
Island Shack
Mermaid Oyster Bar
Dick & Jane's
Marylou
Blend Williamsburg
SAINT Restaurant Bar
Soda Club
Habana Outpost
Yakiniku Gen - East Village
Market Table
Two Hands - Williamsburg
Jajaja - West Village
Lula Mae
Sullaluna
Meadowsweet
Isla & Co. Williamsburg
Bandits Diner & Dive
Sushi By Bou - East Village
The Clam
Tacombi - Bleecker Street
Little Charli
Amelie Bistro & Wine Bar
Poulette - Barclay Center
Charm Bar & Restaurant
The Garret West
Hole in the Wall, Williamsburg
L'Accolade
Springbone Kitchen - B
Mr. Capri
The Little Owl
Third Times a Charm
Boucherie - West Village
Shmoné
Askili Orchard
Nomé
Claro
The Beer Garage - West
Mamali
6 Restaurant
OLIO E PIU - NYC
Petite Boucherie
The Warren
Miti Miti - Brooklyn
Meraki Bistro Brooklyn
Tacombi - Williamsburg
Kappo Sono
The Beer Garage - Park Slope
Wild Park Slope
Due West
Bar Francis
Dejavu
Bird Dog
Bogota Latin Bistro
REYNA
RedFarm - West Village
Ciccio Cincin
The Butcher's Daughter
Jajaja - Williamsburg
WILD - New York
WINNER Butcher
The Stand
Le Petit Village
Left Bank
Place des Fêtes
Recette
The District
The Golden Swan
White Horse Tavern
Ambra
Simply Greek
gertrude's
Nuyores
Kanyakumari
The Mary Lane
Boucherie - Union Square
Bartolo
Laut
Cafe Colette
Union Square Mission
Wthn - Williamsburg
Stafili Wine Cafe
Tarallucci e Vino - Union Square
Rosa Mexicano - Union Square
FYC/NYC
Little Maven
Mable's Smokehouse
Aliya Cocktail Den
Brook & Lyn Eating
Continent Brooklyn
Meximodo - Jersey City
Drai's Supper Club
Amorina Cucina Rustica
Chica & The Don
Kellogg's Diner
HAAM Caribbean Plant
Cosme
Meduza New York
Serafina Meatpacking
Da Nonna Rosa
KRU
Chela
Slate
Le Bistroquet
IKOS
Common Country
Hudson Hall
Philippe Chow - NYC Downtown
Tacombi - Flatiron
Audace
Under The Boot
Little Rascal - Greenpoint
Hole in the Wall, Flatiron
Sarabeth's - Park Ave
El Coco - Chelsea
J. Bespoke
Dhaba
Mathews Food & Drink
Bathtub Gin - NY
El Bar
ofCorsica
Miru
Lokal Eatery & Bar
Tarallucci e Vino - Nomad
Six26 Lounge & Rooftop
The Ashford
PLNT Burger - Nomad
Sushi By Bou - Chelsea
City Winery - New York
Bazár Tapas Bar and Restaurant
Mamazul
Bocca di Bacco - Chelsea
Casa Ora
Fornino
Urban Vegan Kitchen
Scarpetta
Ulivo
Lola's
The Seville
Cucina Alba - New York
WINNER Bakery
Ursula
Little Red Kitchen Bakeshop
Good Thanks
Nubeluz - NoMad
Runner Up
Trós Greek Street Food
Yakitori Nonono
Cafe Mado
Sushi By Bou - Hoboken
Sushi By Bou - Nomad
The Ainsworth - Hoboken
Nonna Dora's - 2nd Ave
Ani Ramen - Jersey City
Sushi By Bou - Jersey City
Moono
Markette
The Argyle
Ten11 Lounge & Bar
ZOI Mediterranean Cuisine
Lore
Hole in the Wall, Murray Hill
Hamilton Pork
WINNER in the Park
Siren Oyster Bar
The Hamilton Inn
Tacombi - Empire State
The Bronze Owl
Lavender Room
Bluestone Lane (Hoboken)
La'Mode BK Caribbean
The Dynamo Room
AMAVI - NYC
Agi's Counter
BarChef
Black Tap Craft Burgers
Clinton Hall 36th Street
Ai Fiori
Serafina Madison 38th
Whitmans - Hudson Yards
Cafe Nunez
Bergen Hall
Daintree
Isla & Co, Midtown
Txula Steak & Bar
La Barra - Mercado Little Spain
Calle Dao - Bryant Park
Sinigual - New York
Yakiniku Toraj
LONGO BROS
sLICe LIC
Point Seven
Little Chef Little Cafe
Planet Hollywood - NYC
Mercato Trattoria Bar
Blend LIC
Stingray Lounge
Tony's Di Napoli - Times Square
Brooklyn Diner - West
Izakaya Futago
Poulette - Midtown East
The Green Room
Brasserie Cognac - Midtown
Ophelia Lounge
Sugar Factory - Times Square
The Purple Tongue
Miss Nellie's
Clinton Hall 51st Street
Bond 45 - NYC
The Ten Bells BK
Cafe Alyce
Yakiniku Gen
Bocca di Bacco - Theater District
Pebble Bar
Sicily Osteria
902 Brewing
Rosa Mexicano - Second Ave
BarRoom at Dick & Jane's
Hold Fast
Dive Bar - BK
Jasmine's Caribbean C
GINGER SAPORI & SAL
Saint Resto-Lounge
Senza Gluten BY JEMIKO
City Winery - Rockefeller
Skybar Rooftop & Lounge
Docks Off 5th - NYC
Starchild Rooftop
Rosevale Cocktail Room
by & by
Carversteak - NYC
Pattin'
Amarone
The Boardroom
The Monkey King
Peggy's
The Blue Dog Cookhouse
Ocean Prime - New York
Osteria La Baia
53
Anatoli 56 Greek Taverna
Lips - NYC
La Grande Boucherie
Russian Samovar Restaurant
Trós Greek Street Food
Blu on the Hudson
Pita Grill
Levante
Tacombi - Long Island City
HaSalon
Les Vagabonds
Lost in Paradise Rooftop
The Consulate Midtown
Poulette - Hell's Kitchen
Serafina Broadway 55th
Serafina Osteria 58th
Paris Bar
Le Jardin Rooftop
Yingtao
Redeye Grill
Trattoria Dell'Arte
BKK New York
El Coco - Hell's Kitchen
Bocca di Bacco - Hell's Kitchen
Brooklyn Diner - West
Loi Estiatorio
Amali
Treadwell Park - NYC Upper
Brasserie Cognac - Central Park
Serafina Always 61st
Marea - NY
Aunts et Uncles
Tony's Di Napoli - Upper West
Rosa Mexicano - Empire State area
Café Fiorello
Tacombi - Upper East Side
Brasserie Cognac - Upper East
Café Paradiso
Sotto Le Stelle
Upper East Side Mission
Sotto La Luna
Calaveras Social
Psari
Dive Bar - LIC
Wthn - Upper West Side
ZOI Mediterranean Restaurant
Harvest Kitchen
Urban Vegan Roots
Arte Cafe
malka
Next Door Provisions
Tri Dim Shanghai
Kebab Aur Sharab
Serafina Fabulous Pizza
Citrico Cafe
Botte Bar - Astoria
RedFarm - Upper West Side
Serafina Upper West 7th
Madame Bonté - Café
Tacombi - Upper West Side
Barkada Social Club
The Rabbit Hole
sLICe Astoria
Bluestone Lane (Upper East)
Sarabeth's - Upper West
Momoya - UWS
Tri Dim Shanghai West
Tarallucci e Vino - Upper East
The Consulate UWS
Bluestone Lane (The C...)
Astoria Provisions
Amelie Bistro & Wine Bar
Soledad
Osteria Accademia
Jacob's Pickles - Upper West
Talia's Steakhouse & Bar
Porta 23
Lê Chai
Tufino Pizzeria Napoletana
Tootles & French
The Calaveras NYC
Calaveras Corner
Lago Kache Restaurant
Melba's Harlem
Bixi
Lido
The Fox
Harlem Poke
Bar 314
Tacombi - Forest Hills
Heat Caribbean Kitchen
Trós Greek Street Food
Ah' Pizz - Harrison
Sugar Factory - Queens
Porto Salvo
Ninja Sushi
Jerkies
Ah' Pizz - Montclair
MM by Morimoto
pastaRAMEN
Ani Ramen - Montclair
Laboratorio Kitchen
Miti Miti Latin Street Food
Lab X
Ani Ramen - Maplewood
Ou La
Frank Anthony's Gourmet
Verona American Grill
Ani Ramen - Cranford
Brews Brothers Grille
Kissaki
Xperience Kitchen & Cocktails
Jia Dim Sum
Tulum Tacos & Tequila
Ani Ramen - Summit
Toast Coffee + Kitchen
Eden's Legacy Restaurant
True Food Kitchen - Garden State
True Food Kitchen - Edison
Tacombi - Westbury
Meximodo - Metuchen
Shaking Crab
Czen Restaurant - Englewood
Bokaguá - The Bronx
True Food Kitchen - Hackensack
Rosa Mexicano - Riverside
Yukka Latin Bistro
Sushi by Bou - New Rochelle
Ani Ramen - Larchmont
Meltemi Greek Restaurant
Billy & Pete's Social
Casita RD
Tulum Tacos & Tequila
Serafina Scarsdale
Foster
Montana Brothers
Café Deux
Roof Taco
Blu Alehouse
1776 Morristown
Baseline Social
Sergio's Restaurant
Greenwich Flavor by M
Orchard Park by David Burke
Edoardo's Trattoria
Deal Lake Bar + Co
Palmetto Southern Kitchen
Barrio Costero
REYLA
Laylow
The Quartiere
Flinders Lane Kitchen
1683 Sports Bar & Rest
Choupette - Darien
Arlo Kitchen & Bar
Toast Coffee + Kitchen
Bar Lucy
MaaMa Restaurant
Lava Sono
MaaMa Restaurant - W
Jacob's Pickles - South
Mighty Quinn's BBQ
Bull Smith's Tavern
Haven Hot Chicken - N
Choupette - Westport
Toast Coffee + Kitchen
Ryebird
Haven Hot Chicken - F`.split('\n').map(s => s.trim()).filter(Boolean);

// Deduplicate
const inkindSet = [...new Set(inkindList)];

// Normalize for matching
function normalize(s) {
  return s.toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[éèê]/g, 'e')
    .replace(/[àâ]/g, 'a')
    .replace(/[ôö]/g, 'o')
    .replace(/[ûü]/g, 'u')
    .replace(/[îï]/g, 'i')
    .replace(/[ç]/g, 'c')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strip location suffixes for matching
function stripLocation(s) {
  return s
    .replace(/\s*[-–—]\s*(nolita|noho|soho|east village|west village|williamsburg|greenpoint|fort greene|bleecker street?|barclay center|park slope|brooklyn|union square|nomad|chelsea|hoboken|jersey city|midtown east?|midtown|hell'?s kitchen|upper west|upper east|central park|times square|theater district|second ave|2nd ave|nyc downtown|nyc upper|nyc|ny|flatiron|empire state|bryant park|long island city|upper west side|upper east side|forest hills|rivington|west|south|bk|lic|queens|astoria|darien|westport|harrison|montclair|maplewood|cranford|summit|metuchen|englewood|hackensack|riverside|larchmont|new rochelle|scarsdale|garden state|edison|westbury|the bronx|morristown)/gi, '')
    .replace(/\s*\(.*?\)/g, '')
    .replace(/,\s*(ny|nyc|new york)$/gi, '')
    .trim();
}

const masterKeys = Object.keys(master);
const masterNorm = {};
masterKeys.forEach(k => {
  masterNorm[normalize(k)] = k;
});

// Also build stripped versions
const masterStripped = {};
masterKeys.forEach(k => {
  const stripped = normalize(stripLocation(k));
  if (!masterStripped[stripped]) masterStripped[stripped] = k;
});

let alreadyTagged = 0;
let newlyTagged = [];
let notFound = [];

function findMatch(inkindName) {
  const norm = normalize(inkindName);
  const stripped = normalize(stripLocation(inkindName));

  // 1. Exact normalized match
  if (masterNorm[norm]) return masterNorm[norm];

  // 2. Exact stripped match
  if (masterStripped[stripped]) return masterStripped[stripped];

  // 3. Check if any master key contains or is contained by the inkind name
  for (const mk of masterKeys) {
    const mkNorm = normalize(mk);
    const mkStripped = normalize(stripLocation(mk));

    // Exact match on stripped versions
    if (stripped === mkStripped) return mk;

    // One contains the other (but require minimum length to avoid false positives)
    if (stripped.length >= 4 && mkStripped.length >= 4) {
      if (stripped === mkStripped) return mk;
    }
  }

  // 4. More aggressive matching - try key substrings
  // e.g. "Musket Room" should match "the musket room"
  for (const mk of masterKeys) {
    const mkNorm = normalize(mk);
    const mkStripped = normalize(stripLocation(mk));

    // One contains the other
    if (stripped.length >= 5 && mkStripped.length >= 5) {
      if (mkStripped.includes(stripped) || stripped.includes(mkStripped)) return mk;
    }
  }

  // 5. Word-level matching for longer names
  const words = stripped.split(' ').filter(w => w.length > 2 && !['the','and','bar','nyc','new','york','restaurant'].includes(w));
  if (words.length >= 2) {
    let bestMatch = null;
    let bestScore = 0;
    for (const mk of masterKeys) {
      const mkWords = normalize(stripLocation(mk)).split(' ').filter(w => w.length > 2 && !['the','and','bar','nyc','new','york','restaurant'].includes(w));
      if (mkWords.length === 0) continue;
      const common = words.filter(w => mkWords.includes(w));
      const score = common.length / Math.max(words.length, mkWords.length);
      if (score > bestScore && score >= 0.6 && common.length >= 2) {
        bestScore = score;
        bestMatch = mk;
      }
    }
    if (bestMatch) return bestMatch;
  }

  return null;
}

// Manual mappings for known tricky matches
const manualMap = {
  "Raf's": "raf's",
  "53": "53",
  "KRU": "kru",
  "Sami & Susu": "sami and susu",
  "The Little Owl": "little owl",
  "Musket Room": "the musket room",
  "Mermaid Oyster Bar": "the mermaid inn",
  "Ursula": "ursula brooklyn",
  "Kanyakumari": "kanyakumari",
  "Meadowsweet": "meadowsweet",
  "The Clam": "the clam",
  "Charlie Bird": "charlie bird",
  "Hamilton Pork": "hamilton pork",
  "Aunts et Uncles": "aunts et uncles",
  "Sotto La Luna": "sotto la luna",
  "malka": "Malka Upper West Side",
  "GINGER SAPORI & SAL": "ginger sapori & salute",
  "Senza Gluten BY JEMIKO": "senza gluten by jemiko -100% gluten free restaurant",
  "Botte Brooklyn": "botte brooklyn",
  "Macao Trading Company": "macao trading company",
  "American Cut Steakhouse": "American Cut Steakhouse Tribeca",
  "Treadwell Park - NYC Downtown": "treadwell park",
  "Treadwell Park - NYC Upper": "treadwell park",
  "Rosa Mexicano - Union Square": "rosa mexicano",
  "Rosa Mexicano - Second Ave": "rosa mexicano",
  "Rosa Mexicano - Empire State area": "rosa mexicano",
  "Rosa Mexicano - Riverside": "rosa mexicano",
  "Sarabeth's - Greenwich": "sarabeth's",
  "Sarabeth's - Park Ave": "sarabeth's",
  "Sarabeth's - Upper West": "sarabeth's",
  "Brooklyn Diner - West": "brooklyn diner",
  "RedFarm - West Village": "redfarm",
  "RedFarm - Upper West Side": "redfarm",
  "Yakiniku Toraj": "yakiniku toraji",
  "Yakiniku Gen - East Village": "yakiniku gen",
  "Yakiniku Gen": "yakiniku gen",
  "Point Seven": "point seven",
  "Tacombi - Upper East Side": "tacombi - upper east side",
  "Bocca di Bacco - Hell's Kitchen": "Bocca di Bacco - Hell's Kitchen",
  "Calle Dao - Bryant Park": "Calle Dao Bryant Park",
  "Brasserie Cognac - Midtown": "brasserie cognac east",
  "Brasserie Cognac - Central Park": "brasserie cognac east",
  "Brasserie Cognac - Upper East": "brasserie cognac east",
  "Jajaja - West Village": "jajaja mexicana",
  "Jajaja - Williamsburg": "jajaja mexicana",
  "ZOI Mediterranean Cuisine": "zoi mediterranean nomad",
  "ZOI Mediterranean Restaurant": "zoi mediterranean nomad",
  "Jacob's Pickles - Upper West": "jacobs pickles",
  "Jacob's Pickles - South": "jacobs pickles",
  "Marea - NY": "marea restaurant",
  "Tony's Di Napoli - Times Square": "tony's di napoli",
  "Tony's Di Napoli - Upper West": "tony's di napoli",
  "Scarpetta": "scarpetta",
  "La Grande Boucherie": "la grande boucherie",
  "Ai Fiori": "ai fiori",
  "Cosme": "cosme",
  "HaSalon": "hasalon",
  "Pasquale Jones": "pasquale jones",
  "Serafina Osteria 58th": "serafina osteria",
  "Tarallucci e Vino - Union Square": "Tarallucci E Vino Upper West Side",
  "Tarallucci e Vino - Nomad": "Tarallucci E Vino Upper West Side",
  "Tarallucci e Vino - Upper East": "Tarallucci E Vino Upper West Side",
  "Nonna Dora's - 2nd Ave": "Nonna Doras",
  "La'Mode BK Caribbean": "La'Mode BK",
  "Serafina Madison 38th": "Serafina 38th",
  "Ophelia Lounge": "Ophelia",
  "Bond 45 - NYC": "Bond 45",
  "The Ten Bells BK": "the ten bells- bk",
  "The Blue Dog Cookhouse": "The Blue Dog Cookhouse And Bar",
  "Ocean Prime - New York": "Ocean Prime - New York",
  "Lips - NYC": "Lips NYC",
  "Russian Samovar Restaurant": "Russian Samovar",
  "The Consulate Midtown": "The Consulate - Midtown",
  "Melba's Harlem": "Melba's",
  "Ah' Pizz - Harrison": "Ah' Pizz",
  "Czen Restaurant - Englewood": "czen restaurant englewood",
  "Mighty Quinn's BBQ": "mighty quinn's barbeque",
  "Shaking Crab": "shaking crab - park slope",
  "Kissaki": "kissaki - bowery",
  "Mable's Smokehouse": "mable's smokehouse & banquet hall",
  "Les Vagabonds": "les vagabonds boucherie",
  "Sugar Factory - Times Square": "Sugar Factory - Queens",
  "Sugar Factory - Queens": "Sugar Factory - Queens",
  "Blend LIC": "blend (williamsburg)",
  "The Ainsworth - Hoboken": "the ainsworth midtown",
  "Bogota Latin Bistro": "Bogota Latin Bistronew",
  "REYNA": "Reyna - NYC",
  "Bird Dog": "bird dog ny",
  "Miti Miti - Brooklyn": "Miti Miti Modern Mexicannew",
  "Meraki Bistro Brooklyn": "meraki greek bistro",
  "OLIO E PIU - NYC": "olio e più - bryant park",
  "Dhaba": "dhaba indian cuisine",
  "Fornino": "Fornino Greenpoint",
  "Loi Estiatorio": "loi estiatorio",
  "Trattoria Dell'Arte": "trattoria dell'arte",
  "BKK New York": "BKK New York",
  "Momoya - UWS": "Momoya Uws",
  "The Consulate UWS": "the consulate uws",
  "Philippe Chow - NYC Downtown": "philippe chow",
  "Meximodo - Jersey City": "meximodo",
  "Sushi By Bou - East Village": "Sushi by Bou - East Village NYCnew",
  "Sushi By Bou - Chelsea": "Sushi by Bou - Chelsea NYC at Bosque Flowers & Coffee",
  "Sushi By Bou - Nomad": "Sushi By Bou - NOMAD NYC @ Hotel32|32",
  "Sushi By Bou - Jersey City": "Sushi by Bou - Jersey City NJ @ Ani Ramen",
  "Sushi By Bou - Hoboken": "Sushi By Bou - Times Square",
  "Sushi by Bou - New Rochelle": "Sushi by Bou Westchester Place",
  "HaSalon": "HaSalon - NYC",
  "Margot Brooklyn": "margot",
  "Little Charli": "Little Charlis",
  "Shmoné": "shmoné wine",
  "Amelie Bistro & Wine Bar": "amelie",
  "Serafina Broadway 55th": "Serafina Broadway",
  "Dive Bar - BK": "Dive Bar LIC",
  "Citrico Cafe": "citrico",
  "Tacombi - Bleecker Street": "tacombi - flatiron",
};

// Explicit false positive exclusions - these should NOT match
const falsePositives = new Set([
  "Bandits Diner & Dive",
  "Springbone Kitchen - B",
  "Third Times a Charm",
  "Mamali",
  "El Bar",
  "Six26 Lounge & Rooftop",
  "Little Red Kitchen Bakeshop",
  "Trós Greek Street Food",
  "Next Door Provisions",
  "Madame Bonté - Café",
  "Frank Anthony's Gourmet",
  "Jia Dim Sum",
  "Orchard Park by David Burke",
  "Haven Hot Chicken - N",
  "Haven Hot Chicken - F",
  "White Horse Tavern",
  "Slate",
  "Charm Bar & Restaurant",
  "SAINT Restaurant Bar",
  "Skybar Rooftop & Lounge",
  "True Food Kitchen - Garden State",
  "True Food Kitchen - Edison",
  "True Food Kitchen - Hackensack",
  "Meltemi Greek Restaurant",
]);

for (const inkindName of inkindSet) {
  // Skip known false positives
  if (falsePositives.has(inkindName)) {
    notFound.push(inkindName);
    continue;
  }

  // Check manual mapping first
  let matchKey = manualMap[inkindName];

  if (!matchKey) {
    matchKey = findMatch(inkindName);
  }

  // Verify match key exists in master
  if (matchKey && !master[matchKey]) {
    // Try case-insensitive lookup
    const found = masterKeys.find(k => k.toLowerCase() === matchKey.toLowerCase());
    if (found) matchKey = found;
    else matchKey = null;
  }

  if (matchKey) {
    if (master[matchKey].inkind === true) {
      alreadyTagged++;
    } else {
      master[matchKey].inkind = true;
      newlyTagged.push(`${inkindName} → ${matchKey}`);
    }
  } else {
    notFound.push(inkindName);
  }
}

console.log(`\n=== INKIND TAGGING RESULTS ===\n`);
console.log(`Already tagged with inkind: ${alreadyTagged}`);
console.log(`Newly tagged with inkind: ${newlyTagged.length}`);
if (newlyTagged.length > 0) {
  newlyTagged.forEach(n => console.log(`  + ${n}`));
}
console.log(`\nNot found in BOOKING_MASTER: ${notFound.length}`);
if (notFound.length > 0) {
  notFound.forEach(n => console.log(`  - ${n}`));
}

// Save
fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + '\n');
console.log(`\nSaved updated BOOKING_MASTER.json`);

import type { Landmark, Quest } from '../domain/types.js'

// Starter content used by the in-memory store and to generate supabase/seed.sql
// (`npm run db:seed-sql`). Ratings, visit counts and story text are placeholders:
// verify them against curated Cebu heritage sources before release (SRS 3.5.4.1).
// imageUrl paths are served from the frontend's public/landmarks folder.

export const LANDMARKS: Landmark[] = [
  {
    id: 'magellans-cross',
    name: "Magellan's Cross",
    category: 'monument',
    district: 'Cebu City (Downtown)',
    latitude: 10.29365,
    longitude: 123.90199,
    imageUrl: '/landmarks/magellan.jpg',
    admissionFee: 0,
    rating: 4.8,
    visitCount: 0,
    estimatedVisitMinutes: 20,
    visitingHours: '8:00 AM - 7:00 PM',
    story: {
      about:
        'A Christian cross planted by Ferdinand Magellan’s expedition when it arrived in Cebu in 1521. It is housed in a small octagonal chapel beside the Basilica del Santo Niño.',
      significance:
        'It marks the beginning of Christianity in the Philippines, linked to the baptism of Rajah Humabon, his wife and their followers in April 1521.',
      architecture:
        'The kiosk-style chapel has a painted ceiling depicting the planting of the cross. The original cross is said to be encased in tindalo wood to protect it.',
      trivia:
        'Many visitors once chipped pieces off the cross believing they had healing powers, which is one reason it was encased.',
    },
  },
  {
    id: 'basilica-santo-nino',
    name: 'Basilica Minore del Santo Niño',
    category: 'church',
    district: 'Cebu City (Downtown)',
    latitude: 10.29433,
    longitude: 123.90189,
    imageUrl: '/landmarks/basilica.jpg',
    admissionFee: 0,
    rating: 4.9,
    visitCount: 0,
    estimatedVisitMinutes: 45,
    visitingHours: '6:00 AM - 8:00 PM',
    story: {
      about:
        'One of the oldest churches in the Philippines, home to the image of the Santo Niño de Cebu, the Holy Child given by Magellan in 1521.',
      significance:
        'It is the center of the Sinulog festival held every January and was elevated to a minor basilica in 1965.',
      architecture:
        'The present stone church dates from the 18th century and blends Romanesque and Baroque elements, with a bell tower rebuilt after the 2013 Bohol earthquake.',
      trivia:
        'The Santo Niño image was reportedly found intact in a burned house in 1565 by soldiers of Miguel López de Legazpi.',
    },
  },
  {
    id: 'fort-san-pedro',
    name: 'Fort San Pedro',
    category: 'fort',
    district: 'Cebu City (Pier Area)',
    latitude: 10.29236,
    longitude: 123.90581,
    imageUrl: '/landmarks/fort.jpg',
    admissionFee: 30,
    rating: 4.7,
    visitCount: 0,
    estimatedVisitMinutes: 60,
    visitingHours: '8:00 AM - 7:00 PM',
    story: {
      about:
        'A triangular military fort near the Cebu port, started in 1565 under Miguel López de Legazpi.',
      significance:
        'It is considered the oldest and smallest triangular bastion fort in the country and served as the nucleus of the first Spanish settlement.',
      architecture:
        'Built of coral stone, it has two sides facing the sea and one facing land, with bastions named La Concepción, Ignacio de Loyola and San Miguel.',
      trivia:
        'Over the centuries it has served as a stronghold, an American barracks, a school, a Japanese prison camp during World War II and a zoo.',
    },
  },
  {
    id: 'yap-sandiego-house',
    name: 'Yap-Sandiego Ancestral House',
    category: 'heritage_house',
    district: 'Parian, Cebu City',
    latitude: 10.29598,
    longitude: 123.90503,
    imageUrl: '/landmarks/yap.jpg',
    admissionFee: 50,
    rating: 4.5,
    visitCount: 0,
    estimatedVisitMinutes: 30,
    visitingHours: '9:00 AM - 6:00 PM',
    story: {
      about:
        'A residence in the old Parian district built in the late 1600s by a Chinese merchant family, and among the oldest houses in the country.',
      significance:
        'It reflects the life of Cebu’s Chinese mestizo merchant class during the Spanish colonial period.',
      architecture:
        'Coral stone walls bound with egg whites support an upper floor of hardwood, topped with clay roof tiles.',
      trivia:
        'The house is still privately owned by descendants of the family, who opened it to visitors as a living museum.',
    },
  },
  {
    id: 'casa-gorordo',
    name: 'Casa Gorordo Museum',
    category: 'museum',
    district: 'Parian, Cebu City',
    latitude: 10.29638,
    longitude: 123.90432,
    imageUrl: '/landmarks/casa.jpg',
    admissionFee: 120,
    rating: 4.6,
    visitCount: 0,
    estimatedVisitMinutes: 45,
    visitingHours: '9:00 AM - 5:00 PM (closed Mondays)',
    story: {
      about:
        'A 19th-century house that was home to the Gorordo family, including Juan Gorordo, the first Filipino bishop of Cebu.',
      significance:
        'Now a museum, it shows domestic life in Cebu from the late Spanish to the early American period.',
      architecture:
        'A classic bahay na bato: coral stone lower floor and an upper floor of molave wood with capiz shell windows.',
      trivia:
        'It was declared a National Historical Landmark and is managed by the Ramon Aboitiz Foundation.',
    },
  },
  {
    id: 'heritage-of-cebu-monument',
    name: 'Heritage of Cebu Monument',
    category: 'monument',
    district: 'Parian, Cebu City',
    latitude: 10.29591,
    longitude: 123.90391,
    imageUrl: '/landmarks/heritage.jpg',
    admissionFee: 0,
    rating: 4.2,
    visitCount: 0,
    estimatedVisitMinutes: 15,
    visitingHours: 'Open daily',
    story: {
      about:
        'A sculptural tableau in Plaza Parian that depicts key events and figures in Cebu’s history.',
      significance:
        'It condenses centuries of Cebuano history, from pre-colonial trade to the Spanish era and beyond, into one public artwork.',
      architecture:
        'Made of concrete, bronze, brass and steel, the work by sculptor Eduardo Castrillo was completed in 2000.',
      trivia:
        'Look for scenes of Magellan’s arrival, the Battle of Mactan, and the Santo Niño among the figures.',
    },
  },
  {
    id: 'museo-sugbo',
    name: 'Museo Sugbo',
    category: 'museum',
    district: 'Cebu City (Downtown)',
    latitude: 10.30128,
    longitude: 123.90685,
    imageUrl: '/landmarks/museo.jpg',
    admissionFee: 75,
    rating: 4.5,
    visitCount: 0,
    estimatedVisitMinutes: 60,
    visitingHours: '9:00 AM - 6:00 PM (closed Mondays)',
    story: {
      about:
        'The Cebu provincial museum, with galleries on Cebu’s history from pre-colonial times to the modern era.',
      significance:
        'The building itself is historic: it was the Carcel de Cebu, the provincial jail, built in the 1870s.',
      architecture:
        'Coral stone prison walls and cell blocks now house exhibit halls arranged around a central courtyard.',
      trivia:
        'During World War II the jail was used by the Japanese forces, and later served again as the provincial jail.',
    },
  },
  {
    id: 'taoist-temple',
    name: 'Cebu Taoist Temple',
    category: 'temple',
    district: 'Beverly Hills, Lahug',
    latitude: 10.33845,
    longitude: 123.89075,
    imageUrl: null,
    admissionFee: 0,
    rating: 4.6,
    visitCount: 0,
    estimatedVisitMinutes: 45,
    visitingHours: '6:00 AM - 5:00 PM',
    story: {
      about:
        'A hillside temple built in 1972 by Cebu’s Chinese community, overlooking the city.',
      significance:
        'It is a center of worship for followers of Taoism and reflects the long presence of Chinese Filipinos in Cebu.',
      architecture:
        'Multi-tiered pagoda roofs, dragon sculptures and a replica of the Great Wall of China lead up to the main temple.',
      trivia:
        'Visitors climb 81 steps to reach the temple, the number of chapters in the Tao Te Ching.',
    },
  },
]

export const QUESTS: Quest[] = [
  {
    id: 'spanish-colonial-trail',
    title: 'Spanish Colonial Heritage Trail',
    description: 'Walk the first Spanish settlement, from the fort by the sea to the oldest church.',
    badgeName: "Magellan's Chronicler",
    landmarkIds: ['fort-san-pedro', 'magellans-cross', 'basilica-santo-nino', 'casa-gorordo'],
  },
  {
    id: 'parian-heritage-walk',
    title: 'Parian Heritage Walk',
    description: 'Explore the old Chinese and mestizo quarter of Cebu.',
    badgeName: 'Old Colonist',
    landmarkIds: ['yap-sandiego-house', 'casa-gorordo', 'heritage-of-cebu-monument'],
  },
  {
    id: 'port-maritime-circuit',
    title: 'Cebu Port & Maritime Circuit',
    description: 'Follow the waterfront where traders, explorers and defenders arrived.',
    badgeName: 'Lapu-Lapu Vanguard',
    landmarkIds: ['fort-san-pedro', 'museo-sugbo', 'magellans-cross'],
  },
]

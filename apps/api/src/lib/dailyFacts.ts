/**
 * Pool locale di curiosità in italiano per il daily greeting.
 * Contenuto statico, nessuna fonte esterna: usato quando la scelta random cade su "fact".
 */

import { pickRandom } from './random';

export const DAILY_FACTS: string[] = [
  'Il miele non scade mai: negli archeologi hanno trovato vasi di miele commestibile nelle tombe egizie, vecchi di oltre 3000 anni.',
  "Un giorno su Venere dura più di un anno su Venere: il pianeta impiega più tempo a ruotare su se stesso che a orbitare intorno al Sole.",
  'I polpi hanno tre cuori e il sangue blu, grazie a una proteina a base di rame chiamata emocianina.',
  "La Torre Eiffel può crescere fino a 15 cm in più durante l'estate, per la dilatazione termica del ferro.",
  'Le banane sono bacche dal punto di vista botanico, mentre fragole e lamponi tecnicamente non lo sono.',
  "Un fulmine è circa cinque volte più caldo della superficie del Sole.",
  'Gli squali esistono da prima degli alberi: comparvero circa 400 milioni di anni fa.',
  "In Finlandia esistono più saune che automobili — quasi una sauna ogni due abitanti.",
  'Il cuore di un gambero è situato nella testa.',
  "Il segnale Wi-Fi non passa bene attraverso l'acqua: per questo negli acquari giganti serve rinforzarlo.",
  'La lingua italiana ha assorbito centinaia di parole arabe, molte legate a commercio e scienza: dogana, tariffa, algebra, zero.',
  'Gli elefanti sono tra i pochi animali capaci di riconoscersi allo specchio, segno di autoconsapevolezza.',
  "Il monte Everest cresce di circa 4 mm all'anno per via del movimento delle placche tettoniche.",
  "In Giappone esiste un'isola, Okunoshima, abitata quasi esclusivamente da conigli selvatici.",
  'Un anno su Mercurio dura 88 giorni terrestri, ma un giorno solare su Mercurio dura circa 176 giorni terrestri.',
  "La parola 'OK' è una delle espressioni più riconosciute al mondo, comprensibile in praticamente ogni lingua.",
  "Le impronte digitali dei koala sono così simili a quelle umane che in teoria potrebbero confondere una scena del crimine.",
  "Il colore naturale delle carote originarie era viola: quelle arancioni sono state selezionate più tardi.",
  'Venezia è costruita su oltre 100 isolotti collegati da centinaia di ponti.',
  "Gli astronauti possono diventare più alti di qualche centimetro nello spazio, per l'assenza di gravità che decomprime la colonna vertebrale.",
  'Il DNA umano è identico a quello dello scimpanzé per circa il 98-99%.',
  "La Grande Muraglia Cinese non è visibile a occhio nudo dallo spazio, contrariamente al mito diffuso.",
  'Le formiche non hanno polmoni: respirano attraverso piccoli fori chiamati spiracoli lungo il corpo.',
  "L'Islanda non ha zanzare, uno dei pochi luoghi al mondo dove questo insetto non riesce a sopravvivere.",
  'Il cervello umano consuma circa il 20% dell\'energia totale del corpo, pur pesando solo il 2% del peso corporeo.',
  "La parola 'ciao' deriva dal veneziano 's-ciavo', che significava 'sono tuo schiavo', come formula di saluto cortese.",
  'Le stelle marine non hanno cervello, ma riescono comunque a percepire luce e movimento con gli occhi sulle punte dei bracci.',
  'Un fulmine colpisce la Terra circa 8 milioni di volte al giorno.',
  "In media una persona cammina l'equivalente di tre giri intorno al mondo nel corso della propria vita.",
  'Il Canada ha più laghi di tutti gli altri paesi del mondo messi insieme.',
  "L'orso polare ha la pelle nera sotto la pelliccia bianca, per assorbire meglio il calore del sole.",
  "La Coca-Cola era originariamente di colore verde, prima di adottare il caramello come colorante.",
  'Le farfalle assaggiano il cibo con le zampe, non con la bocca.',
  "Il numero 4 è considerato sfortunato in molte culture dell'Asia orientale, perché la sua pronuncia ricorda la parola 'morte'.",
  'Gli struzzi possono correre più veloci di un cavallo, raggiungendo picchi vicini ai 70 km/h.',
  "Il Sole rappresenta circa il 99,8% della massa totale del Sistema Solare.",
  'Un fiocco di neve può impiegare da pochi minuti a più di un\'ora per cadere dalla nuvola al suolo.',
  "La parola più lunga della lingua italiana standard è 'precipitevolissimevolmente', con 26 lettere.",
  "I gatti trascorrono in media tra il 60% e il 70% della loro vita dormendo.",
  'Il Colosseo poteva essere allagato per simulare battaglie navali durante i primi anni di utilizzo.',
  "L'acqua calda può ghiacciare più velocemente dell'acqua fredda in certe condizioni: è noto come effetto Mpemba.",
  'I delfini si danno un nome a vicenda, usando fischi unici che li identificano come individui.',
  "In Svezia esiste il diritto di libero accesso alla natura, chiamato 'allemansrätten', che permette a chiunque di camminare, campeggiare e raccogliere frutti in quasi ogni terreno.",
  'Le giraffe hanno lo stesso numero di vertebre cervicali degli esseri umani: sette, ma molto più lunghe.',
  "Il vulcano Olympus Mons su Marte è la montagna più alta conosciuta nel Sistema Solare, quasi tre volte l'Everest.",
  "L'inchiostro delle piovre veniva usato in passato come colorante marrone chiamato seppia.",
  'Le tartarughe possono respirare attraverso la pelle e, in alcune specie, anche attraverso la cloaca.',
  "Il termine 'salario' deriva dal latino 'salarium', legato al sale, un tempo usato anche come forma di pagamento.",
  "Un gruppo di fenicotteri si chiama 'flamboyance'.",
  "La Namibia è stato il primo paese al mondo a inserire la tutela dell'ambiente nella propria costituzione.",
  "Il pianeta Saturno è così poco denso che, ipoteticamente, galleggerebbe in una vasca d'acqua abbastanza grande.",
  "L'espressione 'per filo e per segno' deriva dal linguaggio dei sarti, che usavano un filo teso per tracciare linee precise.",
  'I koala dormono fino a 20 ore al giorno, tra le durate di sonno più lunghe nel regno animale.',
  "Il Mar Morto è così salato che è quasi impossibile affondarvi: la densità dell'acqua sostiene naturalmente il corpo.",
  'Le api comunicano la posizione dei fiori alle altre api compiendo una particolare "danza a otto".',
  "Il primo messaggio di testo (SMS) della storia diceva semplicemente 'Merry Christmas', inviato nel 1992.",
];

/**
 * Returns one random fact from the local curated pool.
 */
export function getRandomFact(): string {
  return pickRandom(DAILY_FACTS);
}

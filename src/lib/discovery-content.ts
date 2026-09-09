/**
 * Editorial copy for the /explore/{food,cuisine,neighbourhood}/* pages.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS.
 *
 *  Every discovery page — all fourteen dishes, all four quartiers, both
 *  cuisines — opened with the same two sentences:
 *
 *    "Comparez les menus et les prix des restaurants ci-dessous. Consultez
 *     chaque établissement pour ses horaires, son adresse et les modes de
 *     commande disponibles."
 *
 *  Everything else on those pages is listing data pulled from the database.
 *  So /explore/food/ndole never said what ndolé is, and
 *  /explore/neighbourhood/bonapriso never said anything about Bonapriso. A
 *  page that ranks for "ndolé Douala" and then fails to describe ndolé is a
 *  page Google has every reason to treat as a doorway: only the name changes
 *  between them.
 *
 *  The fix is not a longer template. It is actual writing, one entry per
 *  slug, which is what lives below. Copy is keyed by the same `discoverySlug`
 *  the routes use, so adding a dish here is all it takes for its page to stop
 *  being generic.
 *
 *  Slugs with no entry fall back to a composed sentence (see `discoveryIntro`)
 *  — still generic, but it degrades to the old behaviour rather than breaking,
 *  and the gap is visible because the page reads thin.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type Copy = { fr: string; en: string };

/**
 * Dishes, keyed by `discoverySlug(name)`.
 *
 * Descriptions stay to what is genuinely true of the dish — origin, what goes
 * in it, what it is eaten with. Nothing here claims anything about a specific
 * restaurant, price or delivery time: those come from the listings on the
 * page itself and would go stale here.
 */
const DISHES: Record<string, Copy> = {
  ndole: {
    fr: "Le ndolé est le plat national du Cameroun. Il se prépare à partir de feuilles de ndolé — amères, longuement lavées et bouillies pour en adoucir le goût — mijotées avec une pâte d'arachide qui donne à la sauce sa texture épaisse et sa couleur profonde. On y ajoute des crevettes séchées, du poisson fumé, du bœuf ou une combinaison des trois. À Douala, il est servi avec des plantains mûrs frits, des miondos (bâtons de manioc) ou du riz blanc. C'est le plat que l'on prépare pour les grandes occasions comme pour un déjeuner de semaine, et chaque cuisine a son dosage d'arachide et d'amertume. Les restaurants ci-dessous le proposent en livraison et à emporter.",
    en: "Ndolé is Cameroon's national dish. It is built on ndolé leaves — bitter, washed and boiled at length to soften them — simmered with a groundnut paste that gives the sauce its thickness and deep colour. Dried shrimp, smoked fish, beef, or all three go in with it. In Douala it is served with fried ripe plantains, miondo (cassava sticks) or plain rice. It is cooked for big occasions and for an ordinary weekday lunch alike, and every kitchen strikes its own balance between the peanut and the bitterness. The restaurants below offer it for delivery and pickup.",
  },
  "poulet-dg": {
    fr: "Poulet DG — pour « poulet Directeur Général ». Le nom dit tout : c'est un plat de prestige, celui que l'on commande quand on reçoit. Du poulet doré à la poêle, puis mijoté avec des plantains mûrs frits, des carottes, des haricots verts, des poivrons et un fond tomaté relevé. Le contraste entre le sucré du plantain et le piquant de la sauce fait sa signature. Il se sert seul, en assiette complète, et supporte bien la livraison : les plantains gardent leur tenue. C'est l'un des plats les plus demandés dans les restaurants de Douala, aussi bien à midi qu'en soirée.",
    en: "Poulet DG — short for \"poulet Directeur Général\", the Director General's chicken. The name says it: this is a dish of some standing, the one you order when there is company. Chicken browned in the pan, then simmered with fried ripe plantains, carrots, green beans, peppers and a seasoned tomato base. The signature is the contrast between the sweetness of the plantain and the heat of the sauce. It is served on its own as a full plate and travels well, since the plantains hold their shape. It is among the most ordered dishes in Douala's restaurants, at lunch and in the evening.",
  },
  "eru-water-fufu": {
    fr: "L'eru vient des régions anglophones du Sud-Ouest et du Nord-Ouest, et il est aujourd'hui partout à Douala. On y émince finement les feuilles d'eru (Gnetum africanum), que l'on cuit avec du waterleaf, de l'huile de palme rouge, des crevettes séchées, de la viande ou du poisson fumé. Le résultat est dense, huileux au bon sens du terme, et se mange avec du water fufu — une pâte de manioc fermenté, souple et légèrement acidulée, qui équilibre la richesse de la sauce. C'est un plat nourrissant, apprécié au déjeuner. Les établissements ci-dessous le servent avec le water fufu préparé le jour même.",
    en: "Eru comes from the anglophone South-West and North-West and is now everywhere in Douala. Eru leaves (Gnetum africanum) are shredded very fine and cooked down with waterleaf, red palm oil, dried shrimp, and meat or smoked fish. The result is dense and richly oiled, and it is eaten with water fufu — a soft, faintly sour fermented cassava dough that balances the sauce. It is a filling dish, most often eaten at lunch. The places below serve it with water fufu made the same day.",
  },
  "poisson-braise": {
    fr: "Le poisson braisé est l'institution des soirées doualaises. Un bar ou un maquereau entier, fendu, mariné à l'ail, au gingembre et au piment, puis grillé lentement au charbon jusqu'à ce que la peau croustille. Il arrive avec des miondos ou des plantains, et surtout avec le piment — cette sauce crue à l'oignon, à la tomate et au piment fort que l'on dose soi-même. On le mange à la main, tard, souvent dehors. Les restaurants ci-dessous le préparent à la commande : comptez le temps de la braise, c'est ce qui fait la différence.",
    en: "Braised fish is the institution of a Douala evening. A whole sea bass or mackerel, split, marinated in garlic, ginger and chilli, then grilled slowly over charcoal until the skin crisps. It arrives with miondo or plantains, and above all with piment — the raw onion, tomato and hot pepper sauce you dose yourself. It is eaten with the hands, late, usually outdoors. The restaurants below grill it to order: allow for the charcoal, which is the whole point.",
  },
  "achu-soupe-jaune": {
    fr: "L'achu est un plat du Nord-Ouest, reconnaissable à sa soupe jaune. Le taro est bouilli puis pilé jusqu'à obtenir une pâte lisse et élastique, servie en dôme, avec un puits au centre pour la sauce. La soupe jaune tire sa couleur de l'huile de palme émulsionnée avec du kanwa (pierre à potasse) et un mélange d'épices du terroir ; on y ajoute tripes, viande de bœuf ou poisson fumé. On mange l'achu avec les doigts, en prélevant la pâte et en la trempant. C'est un plat de fête, technique à réussir, que peu de cuisines proposent tous les jours.",
    en: "Achu is a North-West dish, recognisable by its yellow soup. Taro is boiled then pounded to a smooth, elastic paste, served as a mound with a well in the middle for the sauce. The yellow soup takes its colour from palm oil emulsified with kanwa (limestone potash) and a blend of local spices; tripe, beef or smoked fish goes in with it. Achu is eaten with the fingers, lifting the paste and dipping it. It is a celebration dish, technically demanding, and few kitchens offer it every day.",
  },
  bhb: {
    fr: "BHB, pour « beignets — haricots — bouillie » : le petit-déjeuner camerounais par excellence. Des beignets soufflés frits à la minute, des haricots mijotés longuement à l'huile de palme et aux épices, et une bouillie de maïs ou de mil servie chaude. Les trois se mangent ensemble, le beignet servant à saucer les haricots. C'est un plat de rue avant tout, vendu dès l'aube aux carrefours de Douala, mais plusieurs établissements le proposent désormais toute la matinée en livraison. Rassasiant, bon marché, et probablement le petit-déjeuner le plus consommé du pays.",
    en: "BHB — beignets, haricots, bouillie — is the Cameroonian breakfast. Puffed beignets fried to order, beans simmered long in palm oil and spices, and a hot maize or millet porridge. The three are eaten together, the beignet used to scoop the beans. It is street food first, sold from dawn at Douala's junctions, but several kitchens now serve it through the morning for delivery. Filling, inexpensive, and probably the most eaten breakfast in the country.",
  },
  ekwang: {
    fr: "L'ekwang demande de la patience. Le macabo est râpé finement, puis enveloppé feuille par feuille dans des feuilles de taro, et l'ensemble cuit lentement dans un bouillon d'huile de palme avec du poisson fumé, des crevettes séchées et de la viande. Les petits paquets s'attendrissent et absorbent le bouillon. C'est un plat du Sud-Ouest, préparé en grande quantité parce que le travail de roulage ne vaut pas la peine pour une portion. Servi bien chaud, il se suffit à lui-même. Peu de restaurants s'y risquent — ceux listés ci-dessous le font.",
    en: "Ekwang takes patience. Cocoyam is grated fine, then wrapped leaf by leaf in cocoyam leaves, and the parcels are cooked slowly in a palm oil broth with smoked fish, dried shrimp and meat. The little parcels soften and take up the broth. It is a South-West dish, made in quantity because the rolling is not worth doing for one portion. Served very hot, it needs nothing alongside it. Few restaurants attempt it — the ones listed below do.",
  },
  "folere-jus-de-bissap": {
    fr: "Le folere — bissap ailleurs en Afrique de l'Ouest — est une infusion de fleurs d'hibiscus séchées, servie très fraîche. Rouge profond, franchement acidulée, on la sucre à la demande et on la parfume souvent à la menthe, au gingembre ou à l'ananas. C'est la boisson qui accompagne naturellement les plats relevés : le poisson braisé, les grillades, le ndolé. Elle se vend en bouteille ou au litre, et se garde au frais quelques jours. Sans alcool, désaltérante, elle est aussi courante lors des cérémonies que sur une table de tous les jours.",
    en: "Folere — bissap elsewhere in West Africa — is an infusion of dried hibiscus flowers, served very cold. Deep red and frankly tart, it is sweetened to taste and often scented with mint, ginger or pineapple. It is the natural companion to the spiced dishes: braised fish, grilled meats, ndolé. It is sold by the bottle or the litre and keeps a few days chilled. Non-alcoholic and thoroughly refreshing, it is as common at ceremonies as on an everyday table.",
  },
  "fufu-kati-kati": {
    fr: "Le kati kati est un poulet grillé du Nord-Ouest, traditionnellement cuit au feu de bois puis rompu à la main et enrobé d'huile de palme rouge, de piment et d'épices — sans sauce liquide. Il se mange avec du fufu de maïs, une pâte ferme que l'on façonne entre les doigts. Le plat est né des cérémonies villageoises, où le poulet était grillé sur place. Sa force tient à la fumée et à l'huile de palme, pas à une sauce longuement mijotée. Direct, généreux, et différent de tout le reste de cette liste.",
    en: "Kati kati is a North-West grilled chicken, traditionally cooked over a wood fire, then broken by hand and coated in red palm oil, chilli and spices — with no liquid sauce. It is eaten with corn fufu, a firm dough shaped between the fingers. The dish comes from village ceremonies, where the chicken was grilled on the spot. Its force comes from smoke and palm oil rather than a long-simmered sauce. Direct, generous, and unlike anything else on this list.",
  },
  grillades: {
    fr: "Les grillades couvrent tout ce qui passe sur la braise : brochettes de bœuf (le soya, mariné aux épices et grillé en fines lamelles), ailes et cuisses de poulet, côtelettes, poisson entier. On les commande au poids ou à la pièce, avec des plantains braisés, des bâtons de manioc et du piment. C'est la cuisine du soir à Douala, celle des tournedos de quartier qui s'installent à la tombée du jour. Simple dans le principe, elle se juge à la marinade et à la maîtrise du feu. Les adresses ci-dessous grillent à la commande.",
    en: "Grillades covers everything that goes over the coals: beef brochettes (soya, spice-marinated and grilled in thin strips), chicken wings and thighs, chops, whole fish. You order by weight or by the piece, with braised plantains, cassava sticks and piment. This is Douala's evening food, the trade of the neighbourhood grills that set up as the light goes. Simple in principle, it is judged on the marinade and the handling of the fire. The addresses below grill to order.",
  },
  "jollof-fried-rice": {
    fr: "Le jollof est le riz cuit directement dans un fond de tomate, d'oignon et de poivron, jusqu'à ce que chaque grain prenne la couleur et le goût de la sauce. Le fried rice, lui, est sauté après cuisson avec des légumes en dés, parfois des crevettes ou du poulet. Les deux se retrouvent sur la même carte à Douala et se commandent volontiers avec du poulet grillé ou du poisson. Le jollof est un terrain de rivalité amicale à travers l'Afrique de l'Ouest ; la version camerounaise se distingue par un assaisonnement plus discret et un accompagnement systématique de plantains.",
    en: "Jollof is rice cooked directly in a base of tomato, onion and pepper until every grain takes the colour and taste of the sauce. Fried rice is stir-fried after cooking with diced vegetables, sometimes shrimp or chicken. Both appear on the same menus in Douala and are usually ordered with grilled chicken or fish. Jollof is a matter of friendly rivalry across West Africa; the Cameroonian version is distinguished by a more restrained seasoning and a plantain served alongside as a matter of course.",
  },
  koki: {
    fr: "Le koki est un gâteau salé de haricots à œil noir. Les haricots sont décortiqués, moulus, montés avec de l'huile de palme rouge jusqu'à obtenir une pâte aérée, puis enveloppés dans des feuilles de bananier et cuits à la vapeur pendant des heures. Il en sort une texture ferme et fondante, d'un orange profond. On le mange chaud, avec des plantains bouillis ou du manioc. C'est un plat de patience et de fête, souvent préparé en grande quantité pour être partagé, et l'un des rares plats camerounais entièrement végétariens dans sa forme la plus simple.",
    en: "Koki is a savoury black-eyed pea cake. The beans are peeled, ground, then whipped with red palm oil into an aerated batter, wrapped in banana leaves and steamed for hours. What comes out is firm and yielding, a deep orange. It is eaten hot with boiled plantains or cassava. It is a dish of patience and celebration, usually made in quantity to be shared, and one of the few Cameroonian dishes that is entirely vegetarian in its simplest form.",
  },
  kondre: {
    fr: "Le kondré est un ragoût de plantains verts et de viande — traditionnellement de la chèvre — mijoté avec un mélange d'épices de l'Ouest camerounais : gingembre, ail, njangsa, poivre de Penja. Les plantains cuisent dans le bouillon jusqu'à devenir fondants tout en gardant leur forme, et absorbent le gras de la viande. C'est un plat des Grassfields, servi lors des cérémonies dans l'Ouest et le Nord-Ouest, et devenu courant à Douala. Riche, épicé sans être brûlant, il se mange à la cuillère.",
    en: "Kondré is a stew of green plantains and meat — goat, traditionally — simmered with a spice blend from western Cameroon: ginger, garlic, njangsa, Penja pepper. The plantains cook in the broth until they yield while holding their shape, taking up the fat from the meat. It is a Grassfields dish, served at ceremonies in the West and North-West, and now common in Douala. Rich, spiced without being fiery, and eaten with a spoon.",
  },
  "mbongo-tchobi": {
    fr: "Le mbongo tchobi est la fierté culinaire des Bassa. Sa couleur noire ne vient pas d'une cuisson trop poussée mais d'épices volontairement brûlées puis réduites en poudre — dont le mbongo, une graine locale — qui donnent une sauce sombre, fumée et profondément parfumée. On y cuit du poisson d'eau douce, du silure le plus souvent, ou de la viande. Servi avec des plantains ou du manioc, c'est un plat que l'on reconnaît immédiatement à l'assiette et que l'on n'oublie pas. Peu de cuisines le maîtrisent vraiment.",
    en: "Mbongo tchobi is the culinary pride of the Bassa. Its black colour does not come from overcooking but from spices deliberately burnt and ground — among them mbongo, a local seed — which give a dark, smoky, deeply aromatic sauce. Freshwater fish, usually catfish, or meat is cooked in it. Served with plantains or cassava, it is a dish you recognise instantly on the plate and do not forget. Few kitchens truly master it.",
  },
  "riz-sauce-tomate-rice-and-stew": {
    fr: "Riz sauce tomate — rice and stew côté anglophone — est le repas de tous les jours. Du riz blanc, une sauce tomate longuement réduite avec de l'oignon, de l'ail et du poivron, et une protéine au choix : poulet, bœuf, poisson ou œuf. Rien d'ostentatoire, et c'est justement l'intérêt : c'est le plat que l'on commande quand on veut manger correctement, vite et sans se ruiner. Chaque cuisine a sa sauce, plus ou moins relevée, plus ou moins riche. C'est aussi le repas le plus livré à Douala.",
    en: "Riz sauce tomate — rice and stew on the anglophone side — is the everyday meal. White rice, a tomato sauce reduced at length with onion, garlic and pepper, and a protein of your choosing: chicken, beef, fish or egg. Nothing showy, which is exactly the point: it is what you order when you want to eat properly, quickly and without spending much. Every kitchen has its own stew, more or less spiced, more or less rich. It is also the most delivered meal in Douala.",
  },
};

/**
 * Quartiers of Douala.
 *
 * Entries exist for quartiers the marketplace does not cover yet. That is
 * deliberate: the copy is ready the day a restaurant signs up there, so a new
 * quartier page is never born thin.
 */
const QUARTIERS: Record<string, Copy> = {
  bonamoussadi: {
    fr: "Bonamoussadi est l'un des quartiers résidentiels les plus vivants du nord de Douala. Bâti autour d'axes larges et de zones pavillonnaires, il concentre une population de classe moyenne, des commerces de proximité et une vie nocturne active — bars, snacks et tournedos qui s'installent le soir le long des grandes rues. On y mange aussi bien du poisson braisé sur la braise du coin qu'un plat servi à table dans un restaurant du quartier. Sa proximité avec Makepe et Logpom en fait une zone de livraison dense, où les trajets restent courts.",
    en: "Bonamoussadi is one of the liveliest residential quarters in northern Douala. Built around wide avenues and low-rise housing, it holds a largely middle-class population, neighbourhood shops and an active night life — bars, snack spots and grills that set up along the main streets after dark. You eat braised fish from a corner grill here as readily as a sit-down plate in a neighbourhood restaurant. Its closeness to Makepe and Logpom makes it a dense delivery area, with short runs.",
  },
  bonapriso: {
    fr: "Bonapriso est le quartier résidentiel haut de gamme de Douala. Arboré, calme, proche du centre administratif de Bonanjo, il accueille une part importante de la communauté expatriée et des familles aisées de la ville. La restauration y est la plus internationale de Douala : cuisine camerounaise soignée, tables européennes et libanaises, pâtisseries et cafés. Les prix y sont plus élevés qu'ailleurs, le service plus formel, et les établissements ouvrent souvent jusqu'à tard. C'est aussi l'un des quartiers où la livraison à domicile est la plus établie.",
    en: "Bonapriso is Douala's upmarket residential quarter. Leafy and quiet, close to the administrative centre at Bonanjo, it houses much of the city's expatriate community and its wealthier families. The dining is the most international in Douala: carefully done Cameroonian cooking, European and Lebanese tables, patisseries and cafés. Prices run higher than elsewhere, service is more formal, and places often stay open late. It is also one of the quarters where home delivery is most established.",
  },
  ndogbong: {
    fr: "Ndogbong est un quartier résidentiel du nord-est de Douala, entre Makepe et Logpom. Moins commerçant que ses voisins, il vit surtout au rythme de ses habitants : marchés de quartier, petites gargotes, restaurants de famille qui servent le déjeuner aux travailleurs du secteur. On y trouve la cuisine camerounaise du quotidien — ndolé, eru, riz sauce tomate — à des prix de quartier plutôt que de centre-ville. Les carrefours principaux, comme Bifaga, concentrent l'essentiel de l'offre de restauration.",
    en: "Ndogbong is a residential quarter in north-eastern Douala, between Makepe and Logpom. Less commercial than its neighbours, it runs to the rhythm of the people who live there: local markets, small eating houses, family restaurants serving lunch to people working nearby. What you find is everyday Cameroonian cooking — ndolé, eru, rice and stew — at neighbourhood rather than city-centre prices. The main junctions, Bifaga among them, hold most of the food.",
  },
  ndokoti: {
    fr: "Ndokoti est l'un des carrefours les plus fréquentés de Douala. Point de passage obligé entre le nord de la ville et le centre, il est en mouvement permanent : taxis, motos, commerces ouverts tard et une densité de restauration rapide qui répond à ce flux. On y mange debout ou sur le pouce — beignets-haricots au petit matin, brochettes et grillades le soir — mais le quartier compte aussi des restaurants installés qui servent des plats complets. C'est une zone où la livraison doit composer avec la circulation : les délais y varient beaucoup selon l'heure.",
    en: "Ndokoti is one of Douala's busiest junctions. An unavoidable crossing point between the north of the city and the centre, it is in constant motion: taxis, motorbikes, shops open late, and a density of quick food that answers that flow. People eat standing or on the move — beignets and beans at first light, brochettes and grills in the evening — but the quarter also has settled restaurants serving full plates. Delivery here contends with the traffic: times vary a good deal by hour.",
  },
  akwa: {
    fr: "Akwa est le cœur commercial et nocturne de Douala. Banques, hôtels, boutiques et bureaux s'y concentrent, et avec eux la plus forte densité de restaurants de la ville : cuisine camerounaise, tables internationales, fast-food et bars qui ne ferment pas avant tard. Le déjeuner y est une affaire d'affaires, le dîner une sortie. C'est le quartier où l'offre est la plus large et la plus continue, du petit-déjeuner à la nuit.",
    en: "Akwa is Douala's commercial and night-time heart. Banks, hotels, shops and offices concentrate here, and with them the city's highest density of restaurants: Cameroonian cooking, international tables, fast food, and bars that do not close early. Lunch here is business; dinner is an outing. It is the quarter with the widest and most continuous offering, from breakfast through to the night.",
  },
  bonanjo: {
    fr: "Bonanjo est le quartier administratif et d'affaires de Douala, siège des institutions et de nombreuses entreprises. La restauration y suit le rythme des bureaux : forte affluence au déjeuner, plus calme le soir. On y trouve des tables soignées, des cantines d'entreprise ouvertes au public et quelques adresses installées de longue date. C'est un secteur où la commande à emporter au déjeuner représente l'essentiel de l'activité.",
    en: "Bonanjo is Douala's administrative and business quarter, seat of the institutions and of many companies. The food follows the office day: busy at lunch, quieter in the evening. There are careful tables here, company canteens open to the public, and a few long-established addresses. Lunchtime takeaway is the bulk of the trade in this district.",
  },
  deido: {
    fr: "Deido est l'un des quartiers historiques de Douala, installé le long du Wouri. Fief traditionnel duala, il conserve une identité forte et un marché animé. La restauration y est populaire et tournée vers le poisson — la proximité du fleuve et du port se lit directement dans les cartes. Poisson braisé, sauces de poisson fumé et plats de manioc y sont la norme plutôt que l'exception.",
    en: "Deido is one of Douala's historic quarters, set along the Wouri. A traditional Duala stronghold, it keeps a strong identity and a busy market. The food is unpretentious and turns on fish — the river and the port read straight off the menus. Braised fish, smoked-fish sauces and cassava dishes are the norm here rather than the exception.",
  },
  makepe: {
    fr: "Makepe est un quartier résidentiel en expansion du nord de Douala, apprécié pour son équilibre entre calme et accessibilité. Le secteur s'est densifié rapidement, et avec lui l'offre de restauration : restaurants de quartier, snacks, adresses de livraison. On y mange surtout de la cuisine camerounaise du quotidien, avec quelques tables plus travaillées le long des axes principaux.",
    en: "Makepe is an expanding residential quarter in northern Douala, valued for its balance of quiet and access. The area has filled in quickly, and the food offering with it: neighbourhood restaurants, snack spots, delivery addresses. What you mostly eat here is everyday Cameroonian cooking, with a few more considered tables along the main roads.",
  },
  bepanda: {
    fr: "Bepanda est un quartier populaire et densément peuplé de Douala, connu pour son marché et son activité de rue permanente. La restauration y est avant tout accessible : gargotes, points de beignets-haricots, grillades du soir. Les prix y sont parmi les plus bas de la ville et les portions généreuses. C'est un secteur où la cuisine de rue camerounaise se trouve dans sa forme la plus directe.",
    en: "Bepanda is a densely populated working-class quarter of Douala, known for its market and its unbroken street activity. The food is affordable above all: eating houses, beignet-and-bean stands, evening grills. Prices are among the lowest in the city and the portions generous. This is where Cameroonian street food is found in its most direct form.",
  },
  bonaberi: {
    fr: "Bonabéri se trouve sur l'autre rive du Wouri, relié au reste de Douala par le pont. À la fois industriel et résidentiel, le quartier fonctionne de manière assez autonome, avec ses propres marchés et ses propres adresses. La restauration y est locale et tournée vers les habitants du secteur. La traversée du pont conditionne les délais de livraison depuis le centre-ville, ce qui explique que l'offre y soit surtout de proximité.",
    en: "Bonabéri sits on the far bank of the Wouri, joined to the rest of Douala by the bridge. Both industrial and residential, it runs fairly self-sufficiently, with its own markets and its own addresses. The food is local and aimed at the people who live there. Crossing the bridge governs delivery times from the city centre, which is why the offering here is mostly close at hand.",
  },
};

/** Cuisines, keyed by `discoverySlug(name)`. */
const CUISINES: Record<string, Copy> = {
  camerounaise: {
    fr: "La cuisine camerounaise reflète la diversité du pays : chaque région y a apporté ses techniques et ses ingrédients. Du littoral viennent les sauces de poisson fumé et le mbongo tchobi ; des Grassfields de l'Ouest, le kondré et les plats d'arachide ; du Nord-Ouest, l'achu et le kati kati ; du Sud-Ouest anglophone, l'eru et l'ekwang. Le fil commun est l'huile de palme rouge, les feuilles vertes cuites longuement, le poisson fumé et les crevettes séchées comme base d'assaisonnement, et le plantain sous toutes ses formes. À Douala, ces traditions se retrouvent sur la même carte.",
    en: "Cameroonian cooking reflects the diversity of the country: every region has brought its techniques and its ingredients. From the coast come the smoked-fish sauces and mbongo tchobi; from the western Grassfields, kondré and the groundnut dishes; from the North-West, achu and kati kati; from the anglophone South-West, eru and ekwang. The common thread is red palm oil, greens cooked at length, smoked fish and dried shrimp as the base of the seasoning, and plantain in every form. In Douala these traditions meet on the same menu.",
  },
  patisserie: {
    fr: "La pâtisserie à Douala mêle héritage français et goûts locaux. On y trouve viennoiseries, gâteaux de fête et entremets à côté de préparations à la banane plantain, à la noix de coco ou à l'arachide. Les pâtisseries de la ville travaillent beaucoup sur commande — anniversaires, mariages, baptêmes — et proposent en parallèle une offre de salon de thé. C'est un segment concentré dans les quartiers les plus aisés, où la clientèle est la plus régulière.",
    en: "Patisserie in Douala mixes a French inheritance with local tastes. Viennoiseries, celebration cakes and entremets sit alongside preparations built on plantain, coconut or groundnut. The city's patisseries work substantially to order — birthdays, weddings, christenings — and run a tea-room trade alongside. It is a segment concentrated in the wealthier quarters, where the custom is most regular.",
  },
};

const BY_KIND: Record<string, Record<string, Copy>> = {
  food: DISHES,
  neighbourhood: QUARTIERS,
  cuisine: CUISINES,
};

/**
 * The editorial paragraph for a discovery page, or a composed fallback.
 *
 * The fallback names the thing and the city rather than repeating the generic
 * "compare menus and prices" line that used to be the entire copy — a page
 * with no entry here is thin, and it should read as specific as it honestly
 * can while someone writes the real text.
 */
export function discoveryIntro(kind: string, slug: string, name: string, fr: boolean): string {
  const entry = BY_KIND[kind]?.[slug];
  if (entry) return fr ? entry.fr : entry.en;

  if (kind === "neighbourhood") {
    return fr
      ? `${name} est l'un des quartiers de Douala couverts par Resto237. Retrouvez ci-dessous les restaurants qui y sont installés, avec leurs menus, leurs prix et leurs modes de commande.`
      : `${name} is one of the Douala neighbourhoods covered by Resto237. Below are the restaurants based there, with their menus, prices and ordering options.`;
  }
  if (kind === "cuisine") {
    return fr
      ? `Découvrez la cuisine ${name.toLowerCase()} à Douala : les restaurants ci-dessous la proposent en livraison, à emporter ou sur place.`
      : `${name} cuisine in Douala: the restaurants below serve it for delivery, pickup or on site.`;
  }
  return fr
    ? `${name} est l'un des plats proposés par les restaurants de Douala sur Resto237. Comparez ci-dessous les établissements qui le préparent, leurs prix et leurs délais.`
    : `${name} is one of the dishes served by Douala restaurants on Resto237. Compare the kitchens that make it below, along with their prices and timings.`;
}

/**
 * A second paragraph stating, in plain words, how you can actually get the
 * food — which is the question these pages exist to answer and the one they
 * conspicuously did not. `/explore/neighbourhood/bonamoussadi` did not contain
 * the word "livraison" anywhere on the page.
 */
export function discoveryAvailability(
  opts: { fr: boolean; count: number; delivery: number; pickup: number; placeLabel: string },
): string | null {
  const { fr, count, delivery, pickup, placeLabel } = opts;
  if (count === 0) return null;

  const modes: string[] = [];
  if (delivery > 0) modes.push(fr ? `${delivery} en livraison` : `${delivery} for delivery`);
  if (pickup > 0) modes.push(fr ? `${pickup} à emporter` : `${pickup} for pickup`);

  const noun = count > 1 ? "restaurants" : "restaurant";

  if (!modes.length) {
    return fr
      ? `${count} ${noun} ${count > 1 ? "sont référencés" : "est référencé"} pour ${placeLabel}. Ouvrez chaque fiche pour ses horaires et ses modes de commande.`
      : `${count} ${noun} listed for ${placeLabel}. Open each one for its hours and ordering options.`;
  }

  const list = fr
    ? modes.length > 1 ? modes.slice(0, -1).join(", ") + " et " + modes[modes.length - 1] : modes[0]
    : modes.length > 1 ? modes.slice(0, -1).join(", ") + " and " + modes[modes.length - 1] : modes[0];

  return fr
    ? `${count} ${noun} ${count > 1 ? "proposent" : "propose"} ${placeLabel} : ${list}. Les prix et les horaires figurent sur chaque fiche.`
    : `${count} ${noun} ${count > 1 ? "offer" : "offers"} ${placeLabel}: ${list}. Prices and hours are on each listing.`;
}

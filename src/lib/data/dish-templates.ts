/**
 * The "popular Cameroonian dishes" offered to a restaurant during its
 * first-login setup.
 *
 * These are the classics nearly every kitchen serves — Ndolé, Poulet DG,
 * Poisson Braisé… — so a new restaurant can start with a full menu in one
 * tap instead of typing eleven dishes one by one.
 *
 * STATIC ON PURPOSE: this is reference content, not tenant data. The seed
 * action snapshots each dish into the restaurant's own menu_items row (same
 * copy-on-write philosophy as order snapshots), so editing the list here
 * never rewrites what a restaurant already has.
 *
 * All dishes are priced uniformly (2500 FCFA — the "just start" price);
 * the manager edits prices and descriptions afterwards like any other dish.
 */

export interface DishTemplate {
  id: string;
  name: string;
  description: string;
  price: number;
  /**
   * Same-origin photo shipped with the app (public/default). A dish photo
   * is what sells a menu; a restaurant that accepts the template gets a
   * real-looking carte immediately and replaces the photo whenever it has
   * its own. The URL is COPIED onto the menu_items row at seed time, so
   * the file can be swapped or the template removed without touching any
   * restaurant's menu.
   */
  image: string;
  category?: "Boissons" | "Plats principaux";
}

export const POPULAR_DISHES: DishTemplate[] = [
  { id: "folere-bissap", name: "Foléré — Jus de bissap", description: "Boisson à base de fleurs d’hibiscus, servie fraîche. Adaptez la description à votre recette.", price: 2500, image: "/default/folere-bissap.jpg", category: "Boissons" },
  { id: "bhb", name: "BHB", description: "Beignets, haricots et bouillie. Précisez les accompagnements et portions proposés par votre restaurant.", price: 2500, image: "/default/bhb.jpg" },
  { id: "rice-and-stew", name: "Riz sauce tomate — Rice and stew", description: "Riz accompagné d’une sauce tomate. Précisez la viande, le poisson ou les accompagnements disponibles.", price: 2500, image: "/default/rice-and-stew.jpg" },
  { id: "jollof-fried-rice", name: "Jollof / Fried rice", description: "Un plat de riz préparé selon votre recette. Choisissez le nom, les ingrédients et les accompagnements de votre version.", price: 2500, image: "/default/jollof-fried-rice.jpg" },
  {
    id: "ndole",
    name: "Ndolé",
    description:
      "Un délicieux ragoût de feuilles de ndolé et d'arachides, préparé avec des crevettes, du poisson ou de la viande, et généralement accompagné de plantain, miondo ou bobolo.",
    price: 2500,
    image: "/default/ndole.jpg",
  },
  {
    id: "poulet-dg",
    name: "Poulet DG",
    description:
      "Un savoureux mélange de poulet frit et de bananes plantains, accompagné de carottes, haricots verts, poivrons et oignons, le tout relevé d'épices.",
    price: 2500,
    image: "/default/poulet-dg.jpg",
  },
  {
    id: "poisson-braise",
    name: "Poisson Braisé",
    description:
      "Un poisson frais grillé au feu de bois ou au charbon, mariné avec des épices, des oignons et des piments, généralement servi avec des plantains, des frites ou une sauce pimentée.",
    price: 2500,
    image: "/default/poisson-braise.jpg",
  },
  {
    id: "eru-water-fufu",
    name: "Eru & Water Fufu",
    description:
      "Un plat traditionnel riche en saveurs, préparé avec des feuilles d'eru, du waterleaf, de l'huile de palme, des crevettes, de la viande ou du poisson, accompagné de water fufu.",
    price: 2500,
    image: "/default/eru-water-fufu.jpg",
  },
  {
    id: "achu-soupe-jaune",
    name: "Achu & Soupe Jaune",
    description:
      "Du taro pilé et bien tendre accompagné d'une soupe jaune à base d'huile de palme et d'épices, généralement servie avec de la viande, du poisson ou de la peau de bœuf.",
    price: 2500,
    image: "/default/achu.jpg",
  },
  {
    id: "grillades",
    name: "Grillades",
    description:
      "Un assortiment de viandes ou de poulet grillés au charbon et délicatement assaisonnés, servis avec des plantains, des frites, une salade ou une sauce pimentée.",
    price: 2500,
    image: "/default/grillades.jpg",
  },
  {
    id: "koki",
    name: "Koki",
    description:
      "Une préparation traditionnelle à base de haricots cornilles écrasés et d'huile de palme, cuite à la vapeur dans des feuilles de bananier, avec parfois des crevettes ou du poisson.",
    price: 2500,
    image: "/default/koki.jpg",
  },
  {
    id: "ekwang",
    name: "Ekwang",
    description:
      "Du taro râpé enveloppé dans des feuilles de taro, puis mijoté avec de l'huile de palme, des crevettes, du poisson et de la viande pour obtenir un plat riche et parfumé.",
    price: 2500,
    image: "/default/ekwang.jpg",
  },
  {
    id: "mbongo-tchobi",
    name: "Mbongo Tchobi",
    description:
      "Du poisson mijoté dans une sauce sombre et très parfumée préparée avec des épices grillées, offrant une saveur fumée, épicée et particulièrement intense.",
    price: 2500,
    image: "/default/mbongo-tchobi.jpg",
  },
  {
    id: "kondre",
    name: "Kondré",
    description:
      "Un plat généreux à base de bananes plantains mijotées avec de la viande, de l'huile de palme et des épices locales jusqu'à obtenir une sauce riche et savoureuse.",
    price: 2500,
    image: "/default/kondre.jpg",
  },
  {
    id: "fufu-kati-kati",
    name: "Fufu & Kati-Kati",
    description:
      "Un fufu de maïs doux et consistant accompagné de poulet Kati-Kati mijoté dans une sauce riche en tomates, oignons, épices et huile, une spécialité traditionnelle du Nord-Ouest camerounais.",
    price: 2500,
    image: "/default/kati-kati.jpg",
  },
];

export const POPULAR_DISH_BY_ID = new Map(POPULAR_DISHES.map((d) => [d.id, d]));
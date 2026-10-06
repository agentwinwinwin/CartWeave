'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { productMaterial, type Product } from './catalog';
import { useCart } from './test-provider';
import StoreFooter from './store-footer';
import NewsletterForm from './newsletter-form';

import type { HomepageFeature } from './catalog';
const glyphs = { search: '⌕', user: '○', bag: '□', arrow: '↗', menu: '☰', close: '×', plus: '+', minus: '−' } as const;
const Icon = ({ name }: { name: keyof typeof glyphs }) => <span aria-hidden="true">{glyphs[name]}</span>;

export default function Storefront({ products, featured }: { products: Product[]; featured: HomepageFeature[] }) {
  const { items: cart, count, total, updateQuantity } = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState('All');
  const [notice, setNotice] = useState('');
  const router=useRouter();
  const ranked = featured.length ? featured : products.map((product) => ({ product, title: product.name, score: 0, listedCount: 0, reason: 'Verified catalog' as const }));
  const merchandisingProducts = [...ranked.map((item) => item.product), ...products.filter((product) => !ranked.some((item) => item.product.id === product.id))];
  const shown = filter === 'All' ? merchandisingProducts.slice(0, 8) : merchandisingProducts.filter((product) => (product.department || 'Clothing') === filter).slice(0, 4);
  const heroFeature = ranked[0];

  const adjust = (lineId: string, delta: number) => {
    const item = cart.find((line) => line.lineId === lineId);
    if (item) updateQuantity(lineId, item.quantity + delta);
  };
  const checkout = () => { setCartOpen(false); router.push('/test-store/checkout'); };
  if (!heroFeature) return <main className="catalog-empty"><h1>Crownley</h1><p>The next product edition is being prepared.</p></main>;
  const hero = heroFeature.product;
  const editorialPrimary = ranked[1] || heroFeature;
  const editorialSecondary = ranked[2] || editorialPrimary;
  const storyFeature = ranked[3] || editorialSecondary;
  const categoryFeatures = Object.fromEntries(['Clothing', 'Shoes', 'Bags', 'Hats'].map((department) => {
    const feature = ranked.find((item) => item.product.department === department);
    const fallback = products.find((product) => product.department === department);
    return [department, feature || (fallback ? { product: fallback, title: fallback.name, score: 0, listedCount: 0, reason: 'Verified catalog' as const } : undefined)];
  })) as Record<string, HomepageFeature | undefined>;

  return (
    <main>
      <div className="announcement home-announcement"><span>New York atelier · Edition 04</span><Link href="/test-store/collections/new-arrivals">Complimentary delivery over $150</Link><span>Clothing · Shoes · Bags · Hats</span></div>
      <header className="site-header home-header">
        <button className="mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
        <Link className="brand" href="/test-store/" aria-label="Crownley home">CROWNLEY <small>NEW YORK</small></Link>
        <nav className="desktop-nav" aria-label="Main navigation"><Link href="/test-store/collections/new-arrivals">New In</Link><Link href="/test-store/collections/clothing">Clothing</Link><Link href="/test-store/collections/shoes">Shoes</Link><Link href="/test-store/collections/bags">Bags</Link><Link href="/test-store/collections/hats">Hats</Link></nav>
        <div className="header-actions"><Link href="/test-store/search" aria-label="Search">Search</Link><button className="bag-button" aria-label={`Cart with ${count} items`} onClick={() => setCartOpen(true)}>Bag <b>{count}</b></button></div>
      </header>

      <section className="hero hero-v2 product-led-hero" id="top"><img src={hero.image} alt={heroFeature.title} /><div className="hero-overlay" /><div className="hero-copy"><p className="eyebrow">LIVE DEMAND · CROWNLEY SELECTED</p><h1>{heroFeature.title}</h1><p>{hero.description || `A verified ${hero.category.toLowerCase()} selected from live supplier demand, available inventory and Crownley category fit.`}</p><div className="hero-product-meta"><span>${hero.price}</span><span>{heroFeature.listedCount ? `${heroFeature.listedCount.toLocaleString()} marketplace listings` : 'Verified supplier catalog'}</span></div><Link className="button light" href={`/test-store/products/${hero.id}`}>Shop this bestseller <Icon name="arrow" /></Link></div><div className="hero-side-note"><span>{hero.department}</span><i /><span>Score {heroFeature.score || 'Verified'}</span></div><Link className="hero-scroll" href="#shop">See the ranked edit ↓</Link></section>

      <section className="atelier-intro" id="shop"><div className="intro-index"><span>01</span><p>The Crownley<br />point of view</p></div><div><p className="eyebrow dark">A COMPLETE WARDROBE</p><h2>Modern form,<br /><em>from head to toe.</em></h2></div><div className="intro-copy"><p>We design clothing, footwear, bags and hats with presence, not noise. Deliberate proportions and tactile materials make every category feel unmistakably Crownley.</p><Link href="/test-store/about">Inside our New York studio <span>↗</span></Link></div></section>

      <section className="collection home-collection"><div className="section-heading"><div><p className="eyebrow dark">THE CURRENT EDIT · 04</p><h2>Objects of <em>desire</em></h2></div><div className="filters" role="group" aria-label="Product filters">{['All', 'Clothing', 'Shoes', 'Bags', 'Hats'].map((item) => <button className={filter === item ? 'active' : ''} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div></div><div className="product-grid home-product-grid" id="new">{shown.map((product, index) => <article className="product-card" key={product.id}><div className="product-image"><Link href={`/test-store/products/${product.id}`}><img src={product.image} alt={product.name} /></Link><span className="product-number">{String(index + 1).padStart(2, '0')}</span>{product.badge && <span className="product-badge">{product.badge}</span>}<Link className="quick-view" href={`/test-store/products/${product.id}`}>Explore the piece <Icon name="arrow" /></Link></div><div className="product-info"><div><Link href={`/test-store/products/${product.id}`}>{product.name}</Link><small>{product.color} · {productMaterial(product)}</small></div><strong>${product.price}</strong></div></article>)}</div><Link className="text-link editorial-link" href="/test-store/collections/new-arrivals">Shop the full edition <span>↗</span></Link></section>

      <section className="editorial-feature product-editorial"><Link className="editorial-tall" href={`/test-store/products/${editorialPrimary.product.id}`}><figure><img src={editorialPrimary.product.image} alt={editorialPrimary.title} /><figcaption>{editorialPrimary.title} · ${editorialPrimary.product.price}</figcaption></figure></Link><div className="editorial-copy"><span>02 / Demand-led curation</span><p className="eyebrow dark">REAL PRODUCTS, RANKED LIVE</p><h2>Demand first.<br /><em>Edited with taste.</em></h2><p>Every featured piece is linked to an active Crownley product page and ranked using supplier demand, listing activity, inventory, imagery and category fit.</p><Link className="button dark" href={`/test-store/products/${editorialPrimary.product.id}`}>Explore the leading style <Icon name="arrow" /></Link></div><Link className="editorial-wide" href={`/test-store/products/${editorialSecondary.product.id}`}><figure><img src={editorialSecondary.product.image} alt={editorialSecondary.title} /><figcaption>{editorialSecondary.title} · ${editorialSecondary.product.price}</figcaption></figure></Link></section>

      <section className="category-index"><header><p className="eyebrow dark">SHOP THE WARDROBE</p><p>Real supplier-linked products in every available department.</p></header>{([{ department: 'Clothing', copy: 'Demand-ranked ready-to-wear' }, { department: 'Shoes', copy: 'Verified footwear' }, { department: 'Bags', copy: 'High-interest carryalls' }, { department: 'Hats', copy: 'Trending finishing pieces' }] as const).map((item, index) => { const feature = categoryFeatures[item.department]; const product = feature?.product; return <Link key={item.department} href={product ? `/test-store/products/${product.id}` : `/test-store/collections/${item.department.toLowerCase()}`}><span>{String(index + 1).padStart(2, '0')}</span><h3>{item.department}</h3><p>{feature?.title || item.copy}</p>{product && <img src={product.image} alt={feature?.title || product.name} />}<b>↗</b></Link>; })}</section>

      <section className="material-feature product-proof" id="story"><Link href={`/test-store/products/${storyFeature.product.id}`}><figure><img src={storyFeature.product.image} alt={storyFeature.product.name} /><span>{storyFeature.score || '✓'}<br /><small>{storyFeature.score ? 'score' : 'live'}</small></span></figure></Link><div><p className="eyebrow">PRODUCT / DEMAND / FULFILLMENT</p><h2>Selected by data.<br /><em>Finished by judgment.</em></h2><p>{storyFeature.product.name} is a live, supplier-linked product selected for category relevance, available inventory, product imagery and marketplace interest—not a decorative campaign image.</p><ul><li><span>01</span>{storyFeature.listedCount ? `${storyFeature.listedCount.toLocaleString()} marketplace listings` : 'Verified supplier catalog'}</li><li><span>02</span>Active Crownley product detail page</li><li><span>03</span>Supplier-linked fulfillment routing</li></ul><Link href={`/test-store/products/${storyFeature.product.id}`}>View product and available options ↗</Link></div></section>

      <section className="client-note"><p className="eyebrow dark">WORN, NOT JUST OWNED</p><blockquote>“The kind of piece that changes how you carry yourself.”</blockquote><div><span>CLIENT SERVICE</span><p>Personal fit and product guidance from our studio</p><Link href="/test-store/collections/new-arrivals">Meet the collection →</Link></div></section>

      <section className="service-grid service-grid-v2"><article><span>01</span><h3>Private styling</h3><p>Personal fit and wardrobe guidance from our New York studio.</p><Link href="/test-store/pages/contact">Book a consultation ↗</Link></article><article><span>02</span><h3>Considered delivery</h3><p>Complimentary US delivery over $150, thoughtfully packed and tracked.</p><Link href="/test-store/pages/shipping-returns">Delivery details ↗</Link></article><article><span>03</span><h3>30 days, unhurried</h3><p>Try every piece at home and return it in original condition.</p><Link href="/test-store/pages/shipping-returns">Returns policy ↗</Link></article></section>
      <section className="newsletter newsletter-v2" id="journal"><div><p className="eyebrow">PRIVATE NOTES · NEW YORK</p><h2>Letters from<br /><em>the atelier.</em></h2></div><div><p>Early access to new editions, material stories, private invitations, and 10% off your first order.</p><NewsletterForm /></div></section>
      <StoreFooter />

      <div className={`drawer-backdrop ${cartOpen ? 'open' : ''}`} onClick={() => setCartOpen(false)} />
      <aside className={`cart-drawer ${cartOpen ? 'open' : ''}`} aria-label="Shopping bag" aria-hidden={!cartOpen} inert={!cartOpen}><div className="drawer-head"><h2>Your bag <span>{count}</span></h2><button onClick={() => setCartOpen(false)} aria-label="Close cart"><Icon name="close" /></button></div>{cart.length === 0 ? <div className="empty-cart"><p>Your bag is waiting.</p><small>Explore clothing and accessories made for your everyday.</small><button className="button dark" onClick={() => setCartOpen(false)}>Continue shopping</button></div> : <><div className="cart-lines">{cart.map((item) => <div className="cart-line" key={item.lineId}><img src={item.image} alt="" /><div><p>{item.name}</p><small>{item.color} · {item.size}</small><div className="qty"><button onClick={() => adjust(item.lineId, -1)}><Icon name="minus" /></button><span>{item.quantity}</span><button onClick={() => adjust(item.lineId, 1)}><Icon name="plus" /></button></div></div><strong>${item.price * item.quantity}</strong></div>)}</div><div className="cart-bottom"><div><span>Subtotal</span><strong>${total}</strong></div><p>{total >= 150 ? 'Complimentary US delivery unlocked.' : `$${150 - total} away from complimentary US delivery.`}</p><Link className="view-bag" href="/test-store/cart">View shopping bag</Link><button className="checkout" onClick={checkout}>Continue to test checkout <span>→</span></button>{notice && <small className="cart-notice">{notice}</small>}<span className="stripe-note">LOCAL SIMULATION · NO CHARGE</span></div></>}</aside>
      <aside className={`mobile-panel ${menuOpen ? 'open' : ''}`} inert={!menuOpen}><button aria-label="Close menu" onClick={() => setMenuOpen(false)}><Icon name="close" /></button><Link href="/test-store/collections/new-arrivals">New In</Link><Link href="/test-store/collections/clothing">Clothing</Link><Link href="/test-store/collections/shoes">Shoes</Link><Link href="/test-store/collections/bags">Bags</Link><Link href="/test-store/collections/hats">Hats</Link><Link href="/test-store/about">Our Story</Link><Link href="/test-store/cart">Shopping Bag ({count})</Link></aside>
      {notice && !cartOpen && <button className="toast" onClick={() => setNotice('')}>{notice} <span>×</span></button>}
    </main>
  );
}

import Link from 'next/link'

const photo = (id: string, width = 760) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=82`

const categories = [
  { name: 'Fashion', note: 'Clothing & accessories', image: 'photo-1483985988355-763728e1935b' },
  { name: 'Fresh market', note: 'Groceries & produce', image: 'photo-1546094096-0df4bcaaa337' },
  { name: 'Electronics', note: 'Phones & technology', image: 'photo-1511707171634-5f897ff02aa9' },
  { name: 'Home', note: 'Furniture & living', image: 'photo-1600210492486-724fe5c67fb0' },
  { name: 'Flowers & gifts', note: 'Thoughtful little things', image: 'photo-1490750967868-88aa4486c946' },
  { name: 'Hardware', note: 'Tools & materials', image: 'photo-1504148455328-c376907d081c' },
]
const products = [
  { name: 'Garden-fresh tomatoes', price: 'UGX 3,000 / kg', seller: 'Fresh market', image: 'photo-1546094096-0df4bcaaa337', shape: 'portrait' },
  { name: 'Wireless headphones', price: 'UGX 185,000', seller: 'Electronics', image: 'photo-1505740420928-5e560c06d30e', shape: 'square' },
  { name: 'A bunch of seasonal roses', price: 'UGX 120,000', seller: 'Flowers & gifts', image: 'photo-1490750967868-88aa4486c946', shape: 'square' },
  { name: 'Everyday leather sneakers', price: 'UGX 240,000', seller: 'Fashion', image: 'photo-1542291026-7eec264c27ff', shape: 'square' },
  { name: 'Solid wood dining chair', price: 'UGX 420,000', seller: 'Home & living', image: 'photo-1505693416388-ac5ce068fe85', shape: 'square' },
]
const editorial = [
  { title: 'Find something fresh', kicker: 'From the neighbourhood market', image: 'photo-1542838132-92c53300491e', href: '#fresh' },
  { title: 'Make room for living', kicker: 'Pieces for the spaces you love', image: 'photo-1600607687939-ce8a6c25118c', href: '#home' },
]

function LeafMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" className="h-8 w-8 shrink-0" fill="none">
    <path d="M8 39C8.5 28 12 17 23 10 30 5.5 37 5 42 5c0 13-2.7 23.4-10.4 30.2C25.8 40.2 16.8 40.5 8 39Z" fill="#2E7D32"/>
    <path d="M7 42C14 31 23 22 37 11" stroke="#A5D6A7" strokeWidth="1.7" strokeLinecap="round"/>
    <path d="M17 30c-.5-4-2.1-6.7-4.5-8.9M23 23c3.3.2 6.2 1.5 8.4 3.8M28.5 17.5c2.7.2 5 .9 6.8 2.3" stroke="#C8E6C9" strokeWidth="1.1" strokeLinecap="round"/>
  </svg>
}
function Heading({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div><p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#64776a]">{eyebrow}</p><h2 className="font-display text-3xl leading-tight tracking-tight text-[#20352a] sm:text-4xl">{title}</h2></div>
    {note ? <p className="max-w-xs text-sm text-[#73766d]">{note}</p> : null}
  </div>
}
function Photo({ id, alt, className = '' }: { id: string; alt: string; className?: string }) {
  return <img src={photo(id)} alt={alt} loading="lazy" className={className}/>
}

export default function StorefrontConceptPage() {
  return <main className="min-h-screen bg-[#F8F6EF] text-[#26332B]">
    <header className="sticky top-0 z-30 border-b border-[#E9E2D4] bg-[#F8F6EF]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1320px] items-center gap-5 px-5 py-3.5 lg:px-9">
        <Link href="/" className="flex shrink-0 items-center gap-1.5" aria-label="Mudaala home"><LeafMark/><span className="font-display text-[25px] font-bold lowercase leading-none tracking-tight text-[#0F3D2E]">mudaala</span></Link>
        <div className="hidden min-w-0 flex-1 md:block"><div className="mx-auto flex max-w-[610px] items-center gap-3 rounded-md border border-[#DEDCCF] bg-[#FFFEFA] px-4 py-3 text-sm text-[#77796F]"><span className="text-lg">⌕</span><span>What are you looking for?</span><span className="ml-auto text-xs text-[#77796F]">Products · Shops · Showrooms</span></div></div>
        <div className="ml-auto flex items-center gap-4 text-sm"><span className="hidden text-[#526357] sm:block">Kampala <span className="text-[#A0A091]">⌄</span></span><Link href="/" className="hidden font-semibold text-[#0F3D2E] sm:block">Sell on Mudaala</Link><span className="text-xl text-[#0F3D2E]">♡</span></div>
      </div>
      <nav className="mx-auto flex max-w-[1320px] items-center gap-7 overflow-x-auto px-5 pb-3 text-[13px] font-semibold lg:px-9">
        <Link href="/" className="border-b-2 border-[#0F3D2E] pb-1 text-[#0F3D2E]">Home</Link><Link href="/#browse" className="pb-1 text-[#687268]">Browse</Link><Link href="/#explore" className="pb-1 text-[#687268]">Explore</Link><Link href="/#shops" className="pb-1 text-[#687268]">Shops</Link><Link href="/#showrooms" className="pb-1 text-[#687268]">Showrooms</Link><span className="ml-auto whitespace-nowrap text-[11px] font-medium text-[#77796F]">Buy and sell near you</span>
      </nav>
    </header>

    <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-5 sm:px-6 lg:px-9 lg:pt-8">
      <section className="grid min-h-[300px] overflow-hidden rounded-[5px] bg-[#E9E8D9] lg:grid-cols-[1fr_.9fr]">
        <div className="flex flex-col justify-center px-7 py-10 sm:px-12 lg:px-14 lg:py-14">
          <p className="mb-5 text-[10px] font-bold uppercase tracking-[.24em] text-[#6B7C68]">Your neighbourhood, in one place</p>
          <h1 className="max-w-[510px] font-display text-[46px] leading-[1.04] tracking-[-.04em] text-[#0F3D2E] sm:text-[58px]">Discover more.<br/><span className="italic text-[#9A7420]">Shop better.</span><br/>Live local.</h1>
          <p className="mt-5 max-w-[370px] text-[15px] leading-7 text-[#58665B]">Good things are closer than you think. Find products, meet local shops and discover places worth stepping into.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Link href="/#browse" className="inline-flex items-center gap-3 bg-[#0F3D2E] px-6 py-3.5 text-sm font-semibold text-white">Explore Mudaala <span className="text-[#F3B51B]">↗</span></Link><Link href="/#shops" className="inline-flex items-center border border-[#B9C1B2] px-6 py-3.5 text-sm font-semibold text-[#0F3D2E]">Meet the shops</Link></div>
        </div>
        <div className="relative min-h-[220px] lg:min-h-[300px]">
          <Photo id="photo-1542838132-92c53300491e" alt="Colourful fresh produce at a local market" className="absolute inset-0 h-full w-full object-cover"/>
          <div className="absolute bottom-5 left-5 max-w-[240px] bg-[#F8F6EF] px-5 py-4 sm:bottom-7 sm:left-7"><p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#71806F]">Around the corner</p><p className="mt-1 font-display text-xl text-[#0F3D2E]">Find your kind of local.</p></div>
        </div>
      </section>

      <section className="mt-10 sm:mt-12">
        <Heading eyebrow="A whole lot to discover" title="What are you looking for?" note="From the everyday to the unexpected — find it with local businesses near you."/>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((item, i) => <Link href="/#browse" key={item.name} className="group relative overflow-hidden bg-[#E8E4D9]">
            <div className="aspect-[1.4] overflow-hidden"><Photo id={item.image} alt={item.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"/></div>
            <div className="border-b border-x border-[#E6E0D5] bg-[#FFFEFA] px-3 py-3"><h3 className="font-display text-lg text-[#20352A]">{item.name}</h3><p className="mt-0.5 text-[10px] text-[#77796F]">{item.note}</p></div>
          </Link>)}
        </div>
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-2">
        {editorial.map((item) => <Link href={item.href} key={item.title} className="group relative min-h-[185px] overflow-hidden bg-[#D8D5C7]">
          <Photo id={item.image} alt={item.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"/>
          <div className="absolute inset-0 bg-gradient-to-t from-[#17291E]/75 via-transparent to-transparent"/>
          <div className="absolute bottom-0 left-0 p-7 text-white"><p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#F3D47B]">{item.kicker}</p><h3 className="mt-2 font-display text-3xl">{item.title}</h3><span className="mt-3 inline-block text-xs font-semibold">Explore the collection ↗</span></div>
        </Link>)}
      </section>

      <section className="mt-12">
        <Heading eyebrow="Worth a closer look" title="Good finds, close to home" note="A little of everything, from businesses around you."/>
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {products.map((item) => <article key={item.name} className="group min-w-0">
            <div className="aspect-[1.08] overflow-hidden bg-[#EAE6DC]"><Photo id={item.image} alt={item.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]"/></div>
            <div className="pt-3"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#7A8579]">{item.seller}</p><h3 className="mt-1 line-clamp-2 text-[13px] font-semibold leading-5 text-[#27362D]">{item.name}</h3><p className="mt-2 text-sm font-bold text-[#0F3D2E]">{item.price}</p></div>
          </article>)}
        </div>
      </section>

      <section className="mt-12 border-y border-[#E3DDCF] py-8">
        <div className="grid gap-7 sm:grid-cols-3">
          <div><p className="font-display text-2xl text-[#0F3D2E]">Find the shop.</p><p className="mt-2 max-w-xs text-sm leading-6 text-[#72766D]">Discover real businesses, their products and the people behind them.</p></div>
          <div><p className="font-display text-2xl text-[#0F3D2E]">Make it yours.</p><p className="mt-2 max-w-xs text-sm leading-6 text-[#72766D]">Browse what is nearby and save the things you would love to come back to.</p></div>
          <div><p className="font-display text-2xl text-[#0F3D2E]">Connect directly.</p><p className="mt-2 max-w-xs text-sm leading-6 text-[#72766D]">Call, message or visit the merchant. Local shopping starts with a real connection.</p></div>
        </div>
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-3 pt-6 text-[11px] text-[#77796F]"><span>Concept preview · Illustrative photography and sample listings, not live inventory.</span><Link href="/" className="font-semibold text-[#0F3D2E]">Return to live Mudaala ↗</Link></footer>
    </div>
  </main>
}

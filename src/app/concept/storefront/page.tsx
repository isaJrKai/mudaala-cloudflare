import Link from 'next/link'

const photo = (id: string, width = 900) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`

const categories = [
  { name: 'Fashion & Apparel', image: 'photo-1483985988355-763728e1935b' },
  { name: 'Electronics & Phones', image: 'photo-1511707171634-5f897ff02aa9' },
  { name: 'Groceries & Food', image: 'photo-1540420773420-3366772f4999' },
  { name: 'Home & Furniture', image: 'photo-1555041469-a586c61ea9bc' },
  { name: 'Flowers & Gifts', image: 'photo-1490750967868-88aa4486c946' },
  { name: 'Hardware & Tools', image: 'photo-1504148455328-c376907d081c' },
  { name: 'Beauty & Health', image: 'photo-1608248543803-ba4f8c70ae0b' },
]

const products = [
  { name: 'Fresh garden tomatoes', price: 'UGX 3,000 / kg', tag: 'Groceries', image: 'photo-1546094096-0df4bcaaa337' },
  { name: 'Wireless headphones', price: 'UGX 185,000', tag: 'Electronics', image: 'photo-1505740420928-5e560c06d30e' },
  { name: 'Seasonal rose bouquet', price: 'UGX 120,000', tag: 'Flowers', image: 'photo-1494972308805-463bc619d34e' },
  { name: 'Solid wood dining set', price: 'UGX 850,000', tag: 'Furniture', image: 'photo-1617806118233-18e1de247200' },
  { name: 'Everyday leather sneakers', price: 'UGX 240,000', tag: 'Fashion', image: 'photo-1542291026-7eec264c27ff' },
  { name: 'Fresh matooke bunch', price: 'UGX 2,000 / kg', tag: 'Produce', image: 'photo-1603833665858-e61d17a86224' },
]

const shops = [
  { name: 'The Good Market', detail: 'Fresh produce · Kampala', image: 'photo-1542838132-92c53300491e' },
  { name: 'Urban Living', detail: 'Home & furniture · Kampala', image: 'photo-1600210492486-724fe5c67fb0' },
  { name: 'Studio Bloom', detail: 'Flowers & gifts · Kampala', image: 'photo-1490750967868-88aa4486c946' },
]

const showrooms = [
  { name: 'Modern Living Showroom', detail: 'Furniture · Ntinda', image: 'photo-1600607687939-ce8a6c25118c' },
  { name: 'The Edit Boutique', detail: 'Fashion · Kololo', image: 'photo-1483985988355-763728e1935b' },
]

function SectionHeading({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="mb-1 text-[10px] font-bold uppercase tracking-[.2em] text-[#64816a]">{eyebrow}</p> : null}
        <h2 className="font-serif text-2xl tracking-tight text-[#202a20] sm:text-3xl">{title}</h2>
      </div>
      <span className="shrink-0 text-xs font-semibold text-[#26733d]">Explore all ↗</span>
    </div>
  )
}

function Photo({ id, alt, className = '' }: { id: string; alt: string; className?: string }) {
  return <img src={photo(id)} alt={alt} className={className} loading="lazy" />
}

export default function StorefrontConceptPage() {
  return (
    <main className="min-h-screen bg-[#f7f4ed] text-[#202820]">
      <header className="sticky top-0 z-30 border-b border-[#e8e2d7] bg-[#fbfaf6]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-5 px-5 py-4 lg:px-10">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="grid size-10 place-items-center rounded-full bg-[#176b38] text-xl text-white">m</span>
            <span><span className="block font-serif text-2xl font-bold leading-none">Mudaala</span><span className="text-[10px] text-[#64816a]">buy and sell near you</span></span>
          </Link>
          <div className="hidden flex-1 md:block">
            <div className="mx-auto flex max-w-2xl items-center rounded-full border border-[#e5dfd4] bg-white px-5 py-3 text-sm text-[#8b8b80] shadow-sm">Search products, shops or showrooms… <span className="ml-auto text-lg">⌕</span></div>
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm"><span className="hidden sm:block">⌖ Kampala</span><span>♡</span><span className="hidden sm:block">Sell on Mudaala</span></div>
        </div>
        <nav className="mx-auto flex max-w-[1440px] items-center gap-2 overflow-x-auto px-5 pb-3 lg:px-10">
          {['Home', 'Browse', 'Explore', 'Shops', 'Showrooms'].map((item, index) => (
            <span key={item} className={`whitespace-nowrap rounded-full px-5 py-2 text-sm font-semibold ${index === 0 ? 'bg-[#176b38] text-white' : 'text-[#465347] hover:bg-[#eee9df]'}`}>{item}</span>
          ))}
          <span className="ml-auto hidden whitespace-nowrap rounded-full bg-[#f5b82e] px-5 py-2 text-sm font-bold text-[#30270f] sm:block">Visit live Mudaala ↗</span>
        </nav>
      </header>

      <div className="mx-auto max-w-[1440px] space-y-12 px-4 py-5 sm:px-6 lg:space-y-16 lg:px-10 lg:py-8">
        <section className="relative isolate min-h-[390px] overflow-hidden rounded-[28px] bg-[#263d2a] sm:min-h-[470px]">
          <Photo id="photo-1600210492486-724fe5c67fb0" alt="Warm, carefully styled living room with natural materials" className="absolute inset-0 -z-20 size-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#1c2c20]/85 via-[#1c2c20]/40 to-transparent" />
          <div className="flex min-h-[390px] max-w-2xl flex-col justify-center px-7 py-12 text-white sm:min-h-[470px] sm:px-14">
            <p className="mb-4 text-xs font-bold uppercase tracking-[.25em] text-[#f5c85b]">A better way to shop local</p>
            <h1 className="max-w-xl font-serif text-5xl leading-[.98] tracking-tight sm:text-7xl">Find your next <em className="text-[#f5c85b]">favourite.</em></h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-white/85 sm:text-lg">From everyday essentials to beautiful discoveries, explore the shops and makers around you.</p>
            <div className="mt-8 flex flex-wrap gap-3"><span className="rounded-full bg-[#f5b82e] px-6 py-3 text-sm font-bold text-[#2b281d]">Start exploring ↗</span><span className="rounded-full border border-white/60 px-6 py-3 text-sm font-semibold">Meet local shops</span></div>
          </div>
        </section>

        <section>
          <SectionHeading title="Explore the way you shop" eyebrow="Many worlds, one marketplace" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {categories.map((item) => <article key={item.name} className="group overflow-hidden rounded-2xl border border-[#e9e2d7] bg-white">
              <div className="aspect-[1.15] overflow-hidden bg-[#eee9df]"><Photo id={item.image} alt={item.name} className="size-full object-cover transition duration-500 group-hover:scale-105" /></div>
              <h3 className="px-3 py-3 text-center text-xs font-bold sm:text-sm">{item.name}</h3>
            </article>)}
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-[1.15fr_1fr_1fr]">
          <div>
            <SectionHeading title="A little inspiration" eyebrow="Curated for you" />
            <article className="relative min-h-[330px] overflow-hidden rounded-2xl bg-[#b8a17d]">
              <Photo id="photo-1490481651871-ab68de25d43d" alt="Thoughtfully styled fashion and accessories" className="absolute inset-0 size-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white"><p className="text-xs uppercase tracking-[.2em]">The weekend edit</p><h3 className="mt-2 font-serif text-3xl">Little things, lovely finds.</h3><p className="mt-2 text-sm text-white/85">A collection of things worth discovering.</p></div>
            </article>
          </div>
          <div>
            <SectionHeading title="Shops to know" eyebrow="Meet the merchants" />
            <div className="space-y-3">{shops.map((shop) => <article key={shop.name} className="flex min-h-[100px] overflow-hidden rounded-2xl border border-[#e9e2d7] bg-white"><Photo id={shop.image} alt={shop.name} className="w-[38%] object-cover" /><div className="flex flex-1 flex-col justify-center p-4"><h3 className="font-serif text-lg">{shop.name}</h3><p className="mt-1 text-xs text-[#77796f]">{shop.detail}</p><span className="mt-3 text-xs font-bold text-[#26733d]">Visit shop ↗</span></div></article>)}</div>
          </div>
          <div>
            <SectionHeading title="Step inside" eyebrow="Showrooms worth a visit" />
            <div className="space-y-3">{showrooms.map((room) => <article key={room.name} className="overflow-hidden rounded-2xl border border-[#e9e2d7] bg-white"><Photo id={room.image} alt={room.name} className="h-[145px] w-full object-cover" /><div className="p-4"><h3 className="font-serif text-lg">{room.name}</h3><p className="mt-1 text-xs text-[#77796f]">{room.detail}</p><span className="mt-3 inline-block text-xs font-bold text-[#26733d]">Explore showroom ↗</span></div></article>)}</div>
          </div>
        </section>

        <section>
          <SectionHeading title="Good finds, close to home" eyebrow="Trending around Kampala" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {products.map((item) => <article key={item.name} className="overflow-hidden rounded-2xl border border-[#e9e2d7] bg-white">
              <div className="relative aspect-square bg-[#eee9df]"><Photo id={item.image} alt={item.name} className="size-full object-cover" /><span className="absolute left-2 top-2 rounded-full bg-[#f7f4ed]/95 px-2 py-1 text-[10px] font-bold text-[#48604b]">{item.tag}</span></div>
              <div className="p-3"><h3 className="line-clamp-2 min-h-10 text-sm font-semibold">{item.name}</h3><p className="mt-2 text-sm font-bold text-[#176b38]">{item.price}</p></div>
            </article>)}
          </div>
        </section>

        <section className="grid gap-4 rounded-[24px] bg-[#e8eddb] p-6 sm:grid-cols-4 sm:p-8">
          {[['✳','Discover locally','Find shops and products around you'],['⌂','Real businesses','Meet the people behind the products'],['♡','Shop with confidence','Clear details and direct contact'],['↗','Support local','Good things grow close to home']].map(([icon,title,detail]) => <div key={title} className="flex items-start gap-3"><span className="text-2xl text-[#26733d]">{icon}</span><div><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-xs leading-relaxed text-[#697265]">{detail}</p></div></div>)}
        </section>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e4ddd1] pt-6 text-xs text-[#73766d]"><span>Concept preview · Illustrative products and merchants, not live inventory.</span><Link href="/" className="font-bold text-[#176b38]">Return to Mudaala ↗</Link></footer>
      </div>
    </main>
  )
}

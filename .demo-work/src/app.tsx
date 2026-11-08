import { useState } from 'react';
type IconProps = { className?: string };

const Menu = ({ className }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
const X = ({ className }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m18 6-12 12M6 6l12 12" /></svg>;
const ArrowRight = ({ className }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>;
const Home = ({ className }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z" /></svg>;
const Building2 = ({ className }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V3h12v19M3 22h18M9 7h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1M10 22v-3h4v3" /></svg>;
const Armchair = ({ className }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M3 13v5h18v-5M5 18l-1 3m15-3 1 3M5 13v-2a2 2 0 0 0-2-2H2v4h20V9h-1a2 2 0 0 0-2 2v2" /></svg>;
const Map = ({ className }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15" /></svg>;
const ChevronDown = ({ className }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>;
const ChevronUp = ({ className }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>;

export default function HouslyArchitecture() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const faqs = [
    {
      question: "Where are your projects located?",
      answer: "While our studio is based in San Francisco, we work on projects throughout Northern California and select locations nationwide. We believe in creating architecture that responds to its specific context and community."
    },
    {
      question: "What is your design process timeline?",
      answer: "Project timelines vary based on scope and complexity. A typical residential project takes 6-12 months from initial concept to construction documentation. We work closely with clients to establish realistic timelines that allow for thoughtful design development."
    },
    {
      question: "How do you approach sustainable design?",
      answer: "Sustainability is integral to our practice, not an add-on. We prioritize passive design strategies, material selection, energy efficiency, and longevity. Every project is designed to minimize environmental impact while maximizing occupant comfort and connection to nature."
    },
    {
      question: "What services do you offer?",
      answer: "We provide comprehensive architectural services including master planning, schematic design, design development, construction documentation, and construction administration. We can tailor our services to meet your project's specific needs."
    },
    {
      question: "Do you work with existing structures?",
      answer: "Absolutely. We enjoy the challenge of adaptive reuse and renovation projects. Whether it's a historic preservation or a modern addition, we approach existing structures with respect while bringing them into dialogue with contemporary living."
    },
    {
      question: "How do we get started?",
      answer: "Begin with an initial consultation where we discuss your vision, site, budget, and timeline. This helps us understand if we're the right fit for your project. From there, we'll outline a customized scope of work and fee proposal."
    }
  ];

  const projects = [
    {
      title: "Villa Serena",
      category: "Residential",
      location: "Malibu, California",
      year: "2024",
      image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=2075&auto=format&fit=crop"
    },
    {
      title: "The Glass Pavilion",
      category: "Commercial",
      location: "Tokyo, Japan",
      year: "2023",
      image: "https://images.unsplash.com/photo-1486718448742-163732cd1544?q=80&w=2076&auto=format&fit=crop"
    },
    {
      title: "Casa Terra",
      category: "Residential",
      location: "Lisbon, Portugal",
      year: "2023",
      image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?q=80&w=2053&auto=format&fit=crop"
    },
    {
      title: "Nordic Retreat",
      category: "Hospitality",
      location: "Oslo, Norway",
      year: "2024",
      image: "https://images.unsplash.com/photo-1518780664697-55e3ad937233?q=80&w=1965&auto=format&fit=crop"
    }
  ];

  const expertise = [
    {
      icon: <Home className="w-6 h-6" />,
      title: "Residential Design",
      description: "Creating homes that balance beauty with livability, where every space serves both form and function."
    },
    {
      icon: <Building2 className="w-6 h-6" />,
      title: "Commercial Architecture",
      description: "Designing workspaces that inspire productivity and reflect the values of forward-thinking organizations."
    },
    {
      icon: <Armchair className="w-6 h-6" />,
      title: "Interior Architecture",
      description: "Curating interiors that harmonize with their architectural shells, creating cohesive spatial experiences."
    },
    {
      icon: <Map className="w-6 h-6" />,
      title: "Urban Planning",
      description: "Shaping communities through thoughtful integration of public spaces, structures, and natural elements."
    }
  ];

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-stone-200">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-stone-50/80 backdrop-blur-md border-b border-stone-200/50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <a href="#" className="text-2xl font-bold tracking-tight text-stone-900">
            Hously.
          </a>
          
          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            {['Work', 'Studio', 'Expertise', 'Contact'].map((item) => (
              <a 
                key={item} 
                href={`#${item.toLowerCase()}`} 
                className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
              >
                {item}
              </a>
            ))}
            <button className="px-5 py-2.5 bg-stone-900 text-stone-50 text-sm font-medium rounded-full hover:bg-stone-800 transition-colors">
              Start a Project
            </button>
          </div>

          {/* Mobile Menu Button */}
          <button 
            className="md:hidden p-2 text-stone-900"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Nav */}
        {isMenuOpen && (
          <div className="md:hidden absolute top-20 left-0 right-0 bg-stone-50 border-b border-stone-200 p-6 flex flex-col gap-4 shadow-lg">
            {['Work', 'Studio', 'Expertise', 'Contact'].map((item) => (
              <a 
                key={item} 
                href={`#${item.toLowerCase()}`} 
                className="text-lg font-medium text-stone-900 py-2 border-b border-stone-100"
                onClick={() => setIsMenuOpen(false)}
              >
                {item}
              </a>
            ))}
            <button className="mt-4 w-full py-3 bg-stone-900 text-stone-50 text-sm font-medium rounded-full">
              Start a Project
            </button>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 md:pt-48 md:pb-32 px-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight text-stone-900 leading-[0.95] max-w-5xl">
            We design spaces <br className="hidden md:block" />
            <span className="text-stone-400">that elevate living.</span>
          </h1>
        </div>
      </section>

      {/* Philosophy Section */}
      <section id="studio" className="py-20 md:py-32 px-6 border-t border-stone-200">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-16 md:gap-24">
          <div>
            <span className="text-sm font-semibold tracking-widest text-stone-400 uppercase mb-4 block">
              Our Philosophy
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-stone-900 mb-6 leading-tight">
              Design with <br /> intention.
            </h2>
            <p className="text-lg text-stone-600 leading-relaxed max-w-md">
              Architecture is more than structure — it's how we experience the world. We create spaces that nurture the human spirit.
            </p>
          </div>
          
          <div className="grid gap-10">
            {[
              { num: "01", title: "Minimal, not empty", desc: "Every element has purpose and space to breathe. We remove the unnecessary to reveal what truly matters." },
              { num: "02", title: "Architecture-led design", desc: "Layouts inspired by structure, rhythm, and materiality. Buildings that speak through proportion and light." },
              { num: "03", title: "Subtle motion", desc: "Motion supports the experience, never distracts. Movement that feels natural, like light shifting through a room." },
              { num: "04", title: "Timeless aesthetic", desc: "Elegant, calm, and enduring visual language. Designs that transcend trends and age with grace." }
            ].map((item, idx) => (
              <div key={idx} className="flex gap-6 group">
                <span className="text-sm font-mono text-stone-400 pt-1">{item.num}</span>
                <div>
                  <h3 className="text-xl font-semibold text-stone-900 mb-2 group-hover:text-stone-600 transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-stone-600 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Selected Works */}
      <section id="work" className="py-20 md:py-32 px-6 bg-stone-100">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6">
            <div>
              <span className="text-sm font-semibold tracking-widest text-stone-400 uppercase mb-4 block">
                Selected Works
              </span>
              <h2 className="text-3xl md:text-4xl font-bold text-stone-900">
                Featured Projects
              </h2>
            </div>
            <a href="#" className="inline-flex items-center gap-2 text-sm font-medium text-stone-900 hover:text-stone-600 transition-colors group">
              View all projects 
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>

          <div className="grid md:grid-cols-2 gap-x-8 gap-y-16">
            {projects.map((project, idx) => (
              <a key={idx} href="#" className="group block">
                <div className="aspect-[4/3] overflow-hidden rounded-sm bg-stone-200 mb-6">
                  <img 
                    src={project.image} 
                    alt={project.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                  />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 sm:gap-4">
                  <div>
                    <h3 className="text-2xl font-semibold text-stone-900 mb-1 group-hover:text-stone-600 transition-colors">
                      {project.title}
                    </h3>
                    <p className="text-sm text-stone-500">
                      {project.category} · {project.location}
                    </p>
                  </div>
                  <span className="text-sm font-mono text-stone-400 shrink-0">
                    {project.year}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Expertise */}
      <section id="expertise" className="py-20 md:py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-3xl mb-16">
            <span className="text-sm font-semibold tracking-widest text-stone-400 uppercase mb-4 block">
              What We Do
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-stone-900 leading-tight">
              Expertise refined <br /> through practice.
            </h2>
            <p className="mt-6 text-lg text-stone-600 leading-relaxed">
              Every project draws from decades of collective experience, resulting in architecture that is both innovative and timeless.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {expertise.map((item, idx) => (
              <div key={idx} className="p-6 rounded-lg border border-stone-200 bg-stone-50 hover:border-stone-300 hover:bg-white transition-all duration-300">
                <div className="w-12 h-12 rounded-full bg-stone-900 text-stone-50 flex items-center justify-center mb-6">
                  {item.icon}
                </div>
                <h3 className="text-xl font-semibold text-stone-900 mb-3">
                  {item.title}
                </h3>
                <p className="text-stone-600 leading-relaxed text-sm">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 md:py-32 px-6 bg-stone-900 text-stone-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-sm font-semibold tracking-widest text-stone-400 uppercase mb-4 block">
              FAQ
            </span>
            <h2 className="text-3xl md:text-4xl font-bold">
              Questions & Answers
            </h2>
          </div>

          <div className="space-y-0 divide-y divide-stone-800">
            {faqs.map((faq, idx) => (
              <div key={idx} className="py-6">
                <button
                  onClick={() => toggleFaq(idx)}
                  className="w-full flex items-center justify-between text-left group"
                >
                  <span className="text-lg md:text-xl font-medium text-stone-100 group-hover:text-white transition-colors pr-8">
                    {faq.question}
                  </span>
                  {openFaq === idx ? (
                    <ChevronUp className="w-5 h-5 text-stone-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-stone-400 shrink-0" />
                  )}
                </button>
                <div 
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    openFaq === idx ? 'max-h-96 opacity-100 mt-4' : 'max-h-0 opacity-0'
                  }`}
                >
                  <p className="text-stone-400 leading-relaxed">
                    {faq.answer}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="contact" className="py-20 md:py-32 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <span className="text-sm font-semibold tracking-widest text-stone-400 uppercase mb-4 block">
            Start a Project
          </span>
          <h2 className="text-4xl md:text-6xl font-bold text-stone-900 mb-8 leading-tight">
            Ready to create <br />
            <span className="text-stone-400">something extraordinary?</span>
          </h2>
          <p className="text-lg text-stone-600 mb-10 max-w-2xl mx-auto">
            Let's discuss how we can bring your vision to life. Every great space begins with a conversation.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button className="w-full sm:w-auto px-8 py-4 bg-stone-900 text-stone-50 text-sm font-medium rounded-full hover:bg-stone-800 transition-colors">
              Begin the conversation
            </button>
            <button className="w-full sm:w-auto px-8 py-4 bg-transparent border border-stone-300 text-stone-900 text-sm font-medium rounded-full hover:bg-stone-100 transition-colors">
              Schedule a call
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-stone-200 bg-stone-50">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-2xl font-bold tracking-tight text-stone-900">
            Hously.
          </div>
          <div className="flex flex-wrap justify-center gap-8 text-sm text-stone-600">
            <a href="#" className="hover:text-stone-900 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-stone-900 transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-stone-900 transition-colors">Instagram</a>
            <a href="#" className="hover:text-stone-900 transition-colors">LinkedIn</a>
          </div>
          <div className="text-sm text-stone-400">
            © {new Date().getFullYear()} Hously Architecture. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

import type { DistributionOrder, FlightOffer, HotelOffer } from "../src/types.js";

export const hotels: HotelOffer[] = [
  { id:"HTL-SHA-001",name:"Waldorf Astoria Shanghai on the Bund",city:"Shanghai",district:"Huangpu District · The Bund",rating:4.9,stars:5,image:"https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80",tags:["River View","Indoor Pool","Fitness Center"],roomName:"Deluxe River View King Room",breakfast:"Breakfast for 2 included",cancelPolicy:"Free cancellation 1 day before check-in",nightlyPrice:1688,currency:"CNY" },
  { id:"HTL-SHA-002",name:"Shangri-La Jing An Shanghai",city:"Shanghai",district:"Jing An District · Nanjing West Road",rating:4.8,stars:5,image:"https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=900&q=80",tags:["Metro Access","Executive Lounge","Family Friendly"],roomName:"Horizon Club City View Room",breakfast:"Breakfast for 2 included",cancelPolicy:"Free cancellation 2 days before check-in",nightlyPrice:1320,currency:"CNY" },
  { id:"HTL-SHA-003",name:"Artyzen HUB Qiantan Shanghai",city:"Shanghai",district:"Pudong New District · Qiantan",rating:4.7,stars:4,image:"https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=900&q=80",tags:["Newly Opened","Design Hotel","Free Parking"],roomName:"Atelier King Room",breakfast:"No breakfast",cancelPolicy:"Free cancellation before 18:00",nightlyPrice:826,currency:"CNY" },
];

export const flights: FlightOffer[] = [
  { id:"FLT-001",airline:"Cathay Pacific",airlineCode:"CX",flightNo:"CX365",departureAirport:"PVG T2",arrivalAirport:"HKG T1",departureTime:"09:40",arrivalTime:"12:30",duration:"2h50m",stops:0,cabin:"Economy",baggage:"1 piece 23kg",price:1680,currency:"CNY",priceKey:"pk_demo_cx365" },
  { id:"FLT-002",airline:"Hong Kong Airlines",airlineCode:"HX",flightNo:"HX237",departureAirport:"PVG T2",arrivalAirport:"HKG T1",departureTime:"11:55",arrivalTime:"14:45",duration:"2h50m",stops:0,cabin:"Economy",baggage:"1 piece 20kg",price:1420,currency:"CNY",priceKey:"pk_demo_hx237" },
  { id:"FLT-003",airline:"China Eastern Airlines",airlineCode:"MU",flightNo:"MU509",departureAirport:"SHA T1",arrivalAirport:"HKG T1",departureTime:"16:20",arrivalTime:"19:10",duration:"2h50m",stops:0,cabin:"Economy",baggage:"1 piece 23kg",price:1560,currency:"CNY",priceKey:"pk_demo_mu509" },
];

export const orders: DistributionOrder[] = [
  { id:"FG202607290018",supplierOrderNo:"FCG-H-882016",productType:"hotel",title:"Waldorf Astoria Shanghai on the Bund",subtitle:"Aug 12-14 · 2 nights",customer:"ZhiLian Tech",amount:3376,currency:"CNY",status:"CONFIRMED",createdAt:"Today 09:42" },
  { id:"FG202607290017",supplierOrderNo:"FL-76282015",productType:"flight",title:"Shanghai → Hong Kong",subtitle:"CX365 · Aug 12",customer:"HengSheng Consulting",amount:3360,currency:"CNY",status:"TICKETED",createdAt:"Today 09:18" },
  { id:"FG202607290016",productType:"hotel",title:"Shangri-La Jing An Shanghai",subtitle:"Aug 18-20 · 2 nights",customer:"XingHai Trading",amount:2640,currency:"CNY",status:"PROCESSING",createdAt:"Today 08:56" },
  { id:"FG202607290015",productType:"flight",title:"Beijing → Singapore",subtitle:"SQ807 · Aug 6",customer:"YuanJing Energy",amount:5280,currency:"CNY",status:"PENDING_PAYMENT",createdAt:"Today 08:31" },
  { id:"FG202607280089",supplierOrderNo:"FCG-H-881967",productType:"hotel",title:"Rosewood Hong Kong",subtitle:"Aug 3-5 · 2 nights",customer:"AoChuang Data",amount:7980,currency:"CNY",status:"REFUNDING",createdAt:"Yesterday 22:14" },
];

import {
  Activity, Atom, Binary, Blocks, Bolt, Book, Bot, Box, Brain, Bug, Camera, Car, Cat, ChartColumn, ChartLine, Check, CircleHelp,
  Clock, Cloud, Code, Cog, Cpu, Database, Dna, Dog, Eye, FileText, FlaskConical, Footprints, Gamepad2, Gem, Globe, Gpu, Hand,
  HandGrab, Heart, Image, Joystick, Keyboard, Layers, Leaf, Lightbulb, List, Map, MessageSquare, Mic, Microchip, Microscope,
  Monitor, Mouse, Network, Package, Pickaxe, Pill, PersonStanding, Puzzle, Radar, RobotArm, Rocket, Scan, Search, Server,
  Shield, Sigma, Sparkles, Sword, Target, Terminal, Timer, TreePine, TriangleAlert, Trophy, Truck, User, Users, Video, X,
  type LucideIcon,
} from "lucide-react";
import type { IconName } from "@/lib/scenes/icons";

// Icon name (the fixed list in lib/scenes/icons.ts) -> drawing.
export const ICONS: Record<IconName, LucideIcon> = {
  robot: Bot, "robot-arm": RobotArm, humanoid: PersonStanding, person: User, people: Users, hand: Hand, grab: HandGrab,
  eye: Eye, camera: Camera, video: Video, image: Image, mic: Mic, brain: Brain, chip: Microchip, cpu: Cpu, gpu: Gpu,
  server: Server, database: Database, cloud: Cloud, network: Network, layers: Layers, code: Code, binary: Binary,
  terminal: Terminal, monitor: Monitor, keyboard: Keyboard, mouse: Mouse, gamepad: Gamepad2, joystick: Joystick,
  document: FileText, book: Book, chat: MessageSquare, chart: ChartLine, "bar-chart": ChartColumn, target: Target,
  trophy: Trophy, lightbulb: Lightbulb, bolt: Bolt, gear: Cog, rocket: Rocket, shield: Shield, clock: Clock,
  timer: Timer, search: Search, scan: Scan, radar: Radar, map: Map, globe: Globe, footprints: Footprints, car: Car,
  truck: Truck, box: Box, package: Package, puzzle: Puzzle, blocks: Blocks, pickaxe: Pickaxe, sword: Sword, gem: Gem,
  tree: TreePine, leaf: Leaf, dna: Dna, microscope: Microscope, flask: FlaskConical, atom: Atom, pill: Pill,
  heart: Heart, activity: Activity, cat: Cat, dog: Dog, bug: Bug, sparkles: Sparkles, sigma: Sigma, check: Check,
  cross: X, warning: TriangleAlert, question: CircleHelp, list: List,
};

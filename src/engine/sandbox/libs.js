// The libraries Tavern Helper puts on SillyTavern's window and copies into every iframe it makes.
// CardForge bundles them into the sandbox, since the sandbox can't load anything from the network.
import _ from "lodash";
import YAML from "yaml";
import { z } from "zod";

window._ = _;
window.YAML = YAML;
window.z = z;

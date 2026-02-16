import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'

export interface Command {
  data: SlashCommandBuilder
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>
}

const commands = new Map<string, Command>()

export function registerCommand(command: Command): void {
  commands.set(command.data.name, command)
}

export function getCommand(name: string): Command | undefined {
  return commands.get(name)
}

export function getAllCommands(): Command[] {
  return Array.from(commands.values())
}

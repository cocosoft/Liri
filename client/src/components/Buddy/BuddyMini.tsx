import BuddyAvatar from './BuddyAvatar';
import { useBuddyStore } from '../../stores/buddyStore';
import type { BuddySpecies, BuddyRarity, BuddyEye } from '../../types';

const DEFAULT_SPECIES: BuddySpecies = 'duck';
const DEFAULT_RARITY: BuddyRarity = 'common';

function BuddyMini({ onClick }: { onClick?: () => void }) {
  const { companion, lastInteraction } = useBuddyStore();

  const species = companion?.species || DEFAULT_SPECIES;
  const rarity = companion?.rarity || DEFAULT_RARITY;
  const eye = (companion?.eye as BuddyEye) || '·';
  const hat = companion?.hat || 'none';
  const shiny = companion?.shiny || false;
  const name = companion?.name;

  return (
    <div
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 cursor-pointer py-2 px-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
    >
      <BuddyAvatar
        species={species}
        rarity={rarity}
        eye={eye}
        hat={hat}
        shiny={shiny}
        size="sm"
        showName={false}
      />
      {name && (
        <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[60px]">
          {name}
        </span>
      )}
      {lastInteraction && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500 text-center leading-tight max-w-[72px] truncate">
          {lastInteraction.message}
        </span>
      )}
    </div>
  );
}

export default BuddyMini;

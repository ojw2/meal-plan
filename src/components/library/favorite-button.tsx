import { Star } from "lucide-react";
import { setFavoriteAction } from "@/app/(app)/library/actions";
import { ActionButton } from "@/components/action-button";
import { cn } from "@/lib/utils";

/** Star toggle for adults; a read-only star for kids. */
export function FavoriteButton({
  recipe,
  canEdit,
}: {
  recipe: { id: string; title: string; isFavorite: boolean };
  canEdit: boolean;
}) {
  const icon = <Star className={cn(recipe.isFavorite && "fill-amber-400 text-amber-500")} />;
  if (!canEdit) {
    return recipe.isFavorite ? (
      <span role="img" aria-label="Favorite" className="flex size-11 items-center justify-center md:size-9 [&_svg]:size-4">
        {icon}
      </span>
    ) : null;
  }
  return (
    <ActionButton
      action={setFavoriteAction}
      fields={{ id: recipe.id, favorite: String(!recipe.isFavorite) }}
      label={recipe.isFavorite ? `Remove ${recipe.title} from favorites` : `Add ${recipe.title} to favorites`}
      variant="ghost"
      className="size-11 md:size-9"
    >
      {icon}
    </ActionButton>
  );
}

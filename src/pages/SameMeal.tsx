// «نفس الوجبة»: the comparison page, in both modes. Opened from the home screens (the meal of the last 4 hours)
// and from a meal's details.
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '../components/ui';
import { SameMealView, useSameMeal } from '../components/SameMeal';
import { MomPage } from './mom/MomUI';
import { t } from '../i18n';

function Body({ big }: { big?: boolean }) {
  const { id } = useParams();
  const same = useSameMeal(id);
  if (!same) return <p className="text-center text-slate-500">{t('ما لقينا الوجبة')}</p>;
  if (!same.matches.length) return <p className="text-center text-slate-500">{t('ما في وجبة مثلها قبل')}</p>;
  return <SameMealView target={same.target} matches={same.matches} big={big} />;
}

export function SameMealPage() {
  const nav = useNavigate();
  return <Page title={t('نفس الوجبة')} back={() => nav(-1)}><Body /></Page>;
}

export function MomSame() {
  return <MomPage title={t('نفس الوجبة')} back="/mom"><div className="overflow-y-auto"><Body big /></div></MomPage>;
}
